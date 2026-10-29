import base64
import json
import math
import random

from odoo import api, fields, models, _
from odoo.exceptions import UserError, ValidationError


class NtmAssembly(models.Model):
    _name = "ntm.assembly"
    _description = "Nut Tightening Assembly"
    _order = "write_date desc, id desc"

    name = fields.Char(required=True, default="New Assembly")
    reference = fields.Char(copy=False, readonly=True, default=lambda self: _("New"))
    image = fields.Binary(string="Top-view Assembly Image", attachment=True, required=True)
    image_filename = fields.Char()
    image_mimetype = fields.Char()
    image_width = fields.Integer()
    image_height = fields.Integer()
    nut_ids = fields.One2many("ntm.nut", "assembly_id", string="Nut Mapping")
    nut_count = fields.Integer(compute="_compute_counts", store=True)
    done_count = fields.Integer(compute="_compute_counts", store=True)
    failed_count = fields.Integer(compute="_compute_counts", store=True)
    pending_count = fields.Integer(compute="_compute_counts", store=True)
    progress = fields.Float(compute="_compute_counts", store=True)
    state = fields.Selection([
        ("draft", "Draft"),
        ("mapped", "Mapped"),
        ("running", "Running"),
        ("pass", "PASS"),
        ("fail", "FAIL"),
    ], default="draft", required=True, tracking=True)
    active_nut_id = fields.Many2one("ntm.nut", string="Current Nut", copy=False)
    last_plc_message = fields.Char(readonly=True)
    simulator_enabled = fields.Boolean(default=True)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get("reference", _("New")) == _("New"):
                vals["reference"] = self.env["ir.sequence"].next_by_code("ntm.assembly") or _("New")
        return super().create(vals_list)

    @api.depends("nut_ids", "nut_ids.status")
    def _compute_counts(self):
        for rec in self:
            rec.nut_count = len(rec.nut_ids)
            rec.done_count = len(rec.nut_ids.filtered(lambda n: n.status == "ok"))
            rec.failed_count = len(rec.nut_ids.filtered(lambda n: n.status == "nok"))
            rec.pending_count = len(rec.nut_ids.filtered(lambda n: n.status in ("pending", "running")))
            rec.progress = (100.0 * rec.done_count / rec.nut_count) if rec.nut_count else 0.0

    def action_open_dashboard(self):
        self.ensure_one()
        return {
            "type": "ir.actions.client",
            "tag": "ntm_roi_dashboard_v3",
            "name": _("Nut Tightening Monitor"),
            "params": {"assembly_id": self.id},
            "context": {"active_id": self.id},
        }

    def action_save_mapping(self, payload):
        self.ensure_one()
        try:
            rows = json.loads(payload) if isinstance(payload, str) else payload
        except Exception as exc:
            raise UserError(_("Invalid nut mapping data.")) from exc
        if not isinstance(rows, list):
            raise ValidationError(_("Nut mapping must be a list."))
        existing = {n.id: n for n in self.nut_ids}
        seen = set()
        for row in rows:
            nut_id = row.get("id")
            vals = {
                "name": (row.get("name") or "").strip() or _("Nut"),
                "sequence": int(row.get("sequence") or 10),
                "roi_x": max(0.0, min(100.0, float(row.get("x", 50)))),
                "roi_y": max(0.0, min(100.0, float(row.get("y", 50)))),
                "roi_r": max(0.5, min(20.0, float(row.get("r", 3)))),
                "arm_x": float(row.get("arm_x") or 0),
                "arm_y": float(row.get("arm_y") or 0),
                "arm_z": float(row.get("arm_z") or 0),
                "encoder_position": int(row.get("encoder_position") or 0),
                "target_torque": float(row.get("target_torque") or 10),
                "torque_min": float(row.get("torque_min") or 8),
                "torque_max": float(row.get("torque_max") or 12),
                "target_angle": float(row.get("target_angle") or 90),
                "angle_min": float(row.get("angle_min") or 70),
                "angle_max": float(row.get("angle_max") or 110),
            }
            if nut_id and int(nut_id) in existing:
                existing[int(nut_id)].write(vals)
                seen.add(int(nut_id))
            else:
                vals["assembly_id"] = self.id
                new = self.env["ntm.nut"].create(vals)
                seen.add(new.id)
        stale = self.nut_ids.filtered(lambda n: n.id not in seen)
        stale.unlink()
        self.write({"state": "mapped" if self.nut_ids else "draft"})
        return True

    def action_start_cycle(self):
        for rec in self:
            if not rec.nut_ids:
                raise UserError(_("Map at least one nut before starting the cycle."))
            rec.nut_ids.write({"status": "pending", "actual_torque": 0, "actual_angle": 0, "failure_reason": False})
            first = rec.nut_ids.sorted(lambda n: (n.sequence, n.id))[:1]
            rec.write({"state": "running", "active_nut_id": first.id, "last_plc_message": "SIMULATOR: cycle started"})
        return True

    def action_process_next(self, force_result="random"):
        self.ensure_one()
        if self.state != "running":
            raise UserError(_("Start the cycle before processing nuts."))
        nut = self.active_nut_id
        if not nut:
            nut = self.nut_ids.filtered(lambda n: n.status == "pending").sorted(lambda n: (n.sequence, n.id))[:1]
        if not nut:
            self.write({"state": "fail" if self.failed_count else "pass", "last_plc_message": "Cycle complete"})
            return True
        if force_result == "ok":
            actual_torque = nut.target_torque
            actual_angle = nut.target_angle
        elif force_result == "nok":
            actual_torque = nut.torque_max + max(1.0, abs(nut.torque_max) * 0.15)
            actual_angle = nut.target_angle
        else:
            actual_torque = round(random.uniform(nut.torque_min - 1.0, nut.torque_max + 1.0), 2)
            actual_angle = round(random.uniform(nut.angle_min - 8.0, nut.angle_max + 8.0), 1)
        ok = nut.torque_min <= actual_torque <= nut.torque_max and nut.angle_min <= actual_angle <= nut.angle_max
        nut.write({
            "actual_torque": actual_torque,
            "actual_angle": actual_angle,
            "status": "ok" if ok else "nok",
            "failure_reason": False if ok else _("Torque or angle outside configured limits"),
            "last_result": "OK" if ok else "NOK",
        })
        self.env["ntm.result"].create({
            "assembly_id": self.id,
            "nut_id": nut.id,
            "actual_torque": actual_torque,
            "actual_angle": actual_angle,
            "encoder_position": nut.encoder_position,
            "result": "ok" if ok else "nok",
            "failure_reason": nut.failure_reason,
            "source": "simulator",
        })
        next_nut = self.nut_ids.filtered(lambda n: n.status == "pending").sorted(lambda n: (n.sequence, n.id))[:1]
        if next_nut:
            self.write({"active_nut_id": next_nut.id, "last_plc_message": "SIMULATOR: moved to %s" % next_nut.name})
        else:
            self.write({
                "active_nut_id": False,
                "state": "fail" if self.nut_ids.filtered(lambda n: n.status == "nok") else "pass",
                "last_plc_message": "SIMULATOR: cycle complete",
            })
        return True

    def action_simulate_ok(self):
        return self.action_process_next("ok")

    def action_simulate_nok(self):
        return self.action_process_next("nok")

    def action_simulate_random(self):
        return self.action_process_next("random")

    def action_reset_cycle(self):
        for rec in self:
            rec.nut_ids.write({"status": "pending", "actual_torque": 0, "actual_angle": 0, "failure_reason": False, "last_result": False})
            rec.write({"state": "mapped" if rec.nut_ids else "draft", "active_nut_id": False, "last_plc_message": "Cycle reset"})
        return True


class NtmNut(models.Model):
    _name = "ntm.nut"
    _description = "Mapped Nut ROI"
    _order = "sequence, id"

    assembly_id = fields.Many2one("ntm.assembly", required=True, ondelete="cascade", index=True)
    name = fields.Char(required=True, default="N-01")
    sequence = fields.Integer(default=10)
    roi_x = fields.Float(string="ROI Centre X (%)", default=50, digits=(6, 2))
    roi_y = fields.Float(string="ROI Centre Y (%)", default=50, digits=(6, 2))
    roi_r = fields.Float(string="ROI Radius (%)", default=3, digits=(6, 2))
    arm_x = fields.Float(string="Arm X (mm)", digits=(10, 3))
    arm_y = fields.Float(string="Arm Y (mm)", digits=(10, 3))
    arm_z = fields.Float(string="Arm Z (mm)", digits=(10, 3))
    encoder_position = fields.Integer(string="Encoder Position / Count")
    target_torque = fields.Float(default=10, digits=(10, 2), required=True)
    torque_min = fields.Float(default=8, digits=(10, 2), required=True)
    torque_max = fields.Float(default=12, digits=(10, 2), required=True)
    target_angle = fields.Float(default=90, digits=(10, 1), required=True)
    angle_min = fields.Float(default=70, digits=(10, 1), required=True)
    angle_max = fields.Float(default=110, digits=(10, 1), required=True)
    actual_torque = fields.Float(readonly=True, digits=(10, 2))
    actual_angle = fields.Float(readonly=True, digits=(10, 1))
    status = fields.Selection([
        ("pending", "Pending"),
        ("running", "In Progress"),
        ("ok", "OK"),
        ("nok", "NOK"),
    ], default="pending", required=True, index=True)
    last_result = fields.Char(readonly=True)
    failure_reason = fields.Char(readonly=True)
    result_ids = fields.One2many("ntm.result", "nut_id")

    @api.constrains("torque_min", "torque_max", "target_torque", "angle_min", "angle_max", "target_angle")
    def _check_limits(self):
        for rec in self:
            if rec.torque_min > rec.torque_max:
                raise ValidationError(_("Minimum torque cannot exceed maximum torque."))
            if rec.angle_min > rec.angle_max:
                raise ValidationError(_("Minimum angle cannot exceed maximum angle."))


class NtmResult(models.Model):
    _name = "ntm.result"
    _description = "Nut Tightening Result"
    _order = "create_date desc, id desc"

    assembly_id = fields.Many2one("ntm.assembly", required=True, ondelete="cascade", index=True)
    nut_id = fields.Many2one("ntm.nut", required=True, ondelete="cascade", index=True)
    actual_torque = fields.Float(digits=(10, 2))
    actual_angle = fields.Float(digits=(10, 1))
    encoder_position = fields.Integer()
    result = fields.Selection([("ok", "OK"), ("nok", "NOK")], required=True)
    failure_reason = fields.Char()
    source = fields.Selection([("simulator", "Simulator"), ("plc", "PLC")], default="simulator", required=True)
