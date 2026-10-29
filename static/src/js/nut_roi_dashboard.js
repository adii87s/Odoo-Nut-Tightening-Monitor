/** @odoo-module **/

import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { Component, onMounted, onWillStart, useRef, useState } from "@odoo/owl";

const DEFAULT_NUT = {
    roi_x: 50, roi_y: 50, roi_r: 2.5,
    arm_x: 0, arm_y: 0, arm_z: 0, encoder_position: 0,
    target_torque: 10, torque_min: 8, torque_max: 12,
    target_angle: 90, angle_min: 70, angle_max: 110,
    actual_torque: 0, actual_angle: 0, status: "pending", last_result: "", failure_reason: "",
};

export class NtmLiveDashboard extends Component {
    static template = "nut_tightening_monitor_v3.NtmLiveDashboard";
    static props = ["*"];

    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.canvasRef = useRef("roiCanvas");

        // Template arrow callbacks call these methods without a receiver.
        // Bind them once so `this.state`, services, and canvas references stay
        // available when a button or input event invokes the callback.
        this.runAction = this.runAction.bind(this);
        this.setInteractionMode = this.setInteractionMode.bind(this);
        this.selectNut = this.selectNut.bind(this);
        this.updateNut = this.updateNut.bind(this);
        this.imageElement = null;
        this.state = useState({
            assemblies: [], assemblyId: null, assembly: null, assemblyName: "",
            nuts: [], imageData: null, imageName: "", imageMimeType: "image/png",
            imageWidth: 0, imageHeight: 0, imageRect: { x: 0, y: 0, width: 0, height: 0 },
            interactionMode: "select", drawingRoi: false, draftRoi: null,
            selectedIndex: -1, cycleBusy: false, zoom: 1,
        });

        onWillStart(async () => {
            this.state.assemblies = await this.orm.searchRead(
                "ntm.assembly", [], ["name", "reference", "state"], { order: "write_date desc, id desc" }
            );
            const requested = this.props.action?.params?.assembly_id || this.props.action?.context?.active_id;
            if (requested && this.state.assemblies.some((a) => a.id === requested)) {
                await this.loadAssembly(requested);
            } else if (this.state.assemblies.length) {
                const demo = this.state.assemblies.find((a) => a.name === "Motor Housing Demo - 8 Nuts");
                await this.loadAssembly((demo || this.state.assemblies[0]).id);
            }
        });
        onMounted(() => this.drawCanvas());
    }

    async loadAssembly(id) {
        const records = await this.orm.read("ntm.assembly", [id], [
            "name", "reference", "image", "image_filename", "image_mimetype", "image_width", "image_height",
            "nut_ids", "state", "last_plc_message", "active_nut_id", "simulator_enabled",
        ]);
        if (!records.length) return;
        const assembly = records[0];
        const nuts = assembly.nut_ids.length ? await this.orm.read("ntm.nut", assembly.nut_ids, [
            "name", "sequence", "roi_x", "roi_y", "roi_r", "arm_x", "arm_y", "arm_z", "encoder_position",
            "target_torque", "torque_min", "torque_max", "target_angle", "angle_min", "angle_max",
            "actual_torque", "actual_angle", "status", "last_result", "failure_reason",
        ]) : [];
        this.state.assemblyId = id;
        this.state.assembly = assembly;
        this.state.assemblyName = assembly.name || "";
        this.state.nuts = nuts.sort((a, b) => a.sequence - b.sequence || a.id - b.id);
        this.state.imageName = assembly.image_filename || "";
        this.state.imageMimeType = assembly.image_mimetype || "image/png";
        this.state.imageData = assembly.image ? `data:${this.state.imageMimeType};base64,${assembly.image}` : null;
        this.state.imageWidth = assembly.image_width || 0;
        this.state.imageHeight = assembly.image_height || 0;
        this.state.selectedIndex = -1;
        const activeId = Array.isArray(assembly.active_nut_id) ? assembly.active_nut_id[0] : false;
        if (activeId) this.state.selectedIndex = this.state.nuts.findIndex((n) => n.id === activeId);
        if (this.state.selectedIndex < 0 && this.state.nuts.length) this.state.selectedIndex = 0;
        this.state.interactionMode = "select";
        this.state.drawingRoi = false;
        this.state.draftRoi = null;
        await this.loadImageElement(this.state.imageData);
        this.drawCanvas();
    }

    async loadImageElement(dataUrl) {
        this.imageElement = null;
        if (!dataUrl) return;
        await new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                this.imageElement = img;
                this.state.imageWidth = img.naturalWidth;
                this.state.imageHeight = img.naturalHeight;
                resolve();
            };
            img.onerror = () => {
                this.imageElement = null;
                this.notification.add("The selected image could not be read. Try a PNG or JPG image.", { type: "danger" });
                resolve();
            };
            img.src = dataUrl;
        });
    }

    async onAssemblyChange(ev) {
        const id = Number(ev.target.value);
        if (id) {
            await this.loadAssembly(id);
            return;
        }
        this.state.assemblyId = null;
        this.state.assembly = null;
        this.state.assemblyName = "";
        this.state.nuts = [];
        this.state.imageData = null;
        this.state.imageName = "";
        this.state.imageWidth = 0;
        this.state.imageHeight = 0;
        this.state.selectedIndex = -1;
        this.imageElement = null;
        this.state.interactionMode = "select";
        this.drawCanvas();
    }

    async onImageSelected(ev) {
        const file = ev.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            this.notification.add("Choose a PNG, JPG, or other image file.", { type: "warning" });
            ev.target.value = "";
            return;
        }
        if (this.state.nuts.length && !window.confirm("Replacing the image clears the existing ROI mapping because the image coordinates will change. Continue?")) {
            ev.target.value = "";
            return;
        }
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
        this.state.imageData = dataUrl;
        this.state.imageName = file.name;
        this.state.imageMimeType = file.type || "image/png";
        this.state.assemblyName = this.state.assemblyName || file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
        this.state.nuts = [];
        this.state.selectedIndex = -1;
        this.state.interactionMode = "draw";
        await this.loadImageElement(dataUrl);
        this.drawCanvas();
        this.notification.add("Image loaded. Choose Draw ROI and drag a circle around the first nut.", { type: "success" });
    }

    setInteractionMode(mode) {
        this.state.interactionMode = mode;
        this.state.drawingRoi = false;
        this.state.draftRoi = null;
        this.drawCanvas();
    }

    canvasPoint(ev) {
        const canvas = this.canvasRef.el;
        const bounds = canvas.getBoundingClientRect();
        return {
            x: (ev.clientX - bounds.left) * canvas.width / bounds.width,
            y: (ev.clientY - bounds.top) * canvas.height / bounds.height,
        };
    }

    pointInsideImage(point) {
        const r = this.state.imageRect;
        return r.width > 0 && point.x >= r.x && point.y >= r.y && point.x <= r.x + r.width && point.y <= r.y + r.height;
    }

    clampToImage(point) {
        const r = this.state.imageRect;
        return { x: Math.max(r.x, Math.min(r.x + r.width, point.x)), y: Math.max(r.y, Math.min(r.y + r.height, point.y)) };
    }

    onCanvasPointerDown(ev) {
        if (!this.state.imageData || !this.imageElement) return;
        ev.preventDefault();
        const point = this.canvasPoint(ev);
        if (!this.pointInsideImage(point)) return;
        if (this.state.interactionMode === "draw") {
            this.state.drawingRoi = true;
            this.state.draftRoi = { startX: point.x, startY: point.y, x: point.x, y: point.y, radius: 0 };
            try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch (_) { /* pointer capture is optional */ }
            this.drawCanvas();
            return;
        }
        const hit = this.findNutAt(point);
        if (hit >= 0) {
            this.state.selectedIndex = hit;
            this.drawCanvas();
        }
    }

    onCanvasPointerMove(ev) {
        if (!this.state.drawingRoi || !this.state.draftRoi) return;
        const point = this.clampToImage(this.canvasPoint(ev));
        const draft = this.state.draftRoi;
        draft.x = draft.startX;
        draft.y = draft.startY;
        draft.radius = Math.hypot(point.x - draft.startX, point.y - draft.startY);
        this.drawCanvas();
    }

    onCanvasPointerUp(ev) {
        if (!this.state.drawingRoi || !this.state.draftRoi) return;
        const point = this.clampToImage(this.canvasPoint(ev));
        const draft = this.state.draftRoi;
        const imageRect = this.state.imageRect;
        const dragRadius = Math.hypot(point.x - draft.startX, point.y - draft.startY);
        if (dragRadius < 8) {
            this.state.drawingRoi = false;
            this.state.draftRoi = null;
            this.drawCanvas();
            this.notification.add("Drag outward from the nut centre to set the circle size.", { type: "warning" });
            return;
        }
        const radiusPx = Math.max(13, dragRadius);
        const x = ((draft.startX - imageRect.x) / imageRect.width) * 100;
        const y = ((draft.startY - imageRect.y) / imageRect.height) * 100;
        const r = (radiusPx / Math.min(imageRect.width, imageRect.height)) * 100;
        const nextNumber = this.nextNutNumber();
        const maxSequence = this.state.nuts.reduce((max, n) => Math.max(max, Number(n.sequence) || 0), 0);
        const nut = {
            ...DEFAULT_NUT,
            id: null, name: `N-${String(nextNumber).padStart(2, "0")}`,
            sequence: maxSequence + 10, roi_x: Number(x.toFixed(2)), roi_y: Number(y.toFixed(2)), roi_r: Number(Math.min(r, 20).toFixed(2)),
            arm_x: 0, arm_y: 0, arm_z: 0, encoder_position: 0,
            target_torque: 10, torque_min: 8, torque_max: 12, target_angle: 90, angle_min: 70, angle_max: 110,
            actual_torque: 0, actual_angle: 0, status: "pending", last_result: "", failure_reason: "",
        };
        this.state.nuts.push(nut);
        this.state.nuts.sort((a, b) => a.sequence - b.sequence || (a.id || 0) - (b.id || 0));
        this.state.selectedIndex = this.state.nuts.findIndex((n) => n === nut);
        this.state.drawingRoi = false;
        this.state.draftRoi = null;
        this.state.interactionMode = "select";
        this.drawCanvas();
        this.notification.add(`${nut.name} created. Assign its sequence, arm position and tightening limits in Nut Setup.`, { type: "success" });
    }

    nextNutNumber() {
        let max = 0;
        for (const nut of this.state.nuts) {
            const match = String(nut.name || "").match(/(\d+)/);
            if (match) max = Math.max(max, Number(match[1]));
        }
        return max + 1;
    }

    findNutAt(point) {
        const rect = this.state.imageRect;
        let best = -1, bestDistance = Infinity;
        this.state.nuts.forEach((nut, index) => {
            const x = rect.x + nut.roi_x / 100 * rect.width;
            const y = rect.y + nut.roi_y / 100 * rect.height;
            const radius = (nut.roi_r || 2.5) / 100 * Math.min(rect.width, rect.height);
            const dist = Math.hypot(point.x - x, point.y - y);
            if (dist <= Math.max(radius + 9, 16) && dist < bestDistance) { best = index; bestDistance = dist; }
        });
        return best;
    }

    drawCanvas() {
        const canvas = this.canvasRef?.el;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = "#e3e8f2";
        ctx.fillRect(0, 0, w, h);
        let rect = { x: 0, y: 0, width: 0, height: 0 };
        if (this.imageElement && this.imageElement.complete && this.imageElement.naturalWidth) {
            const scale = Math.min(w / this.imageElement.naturalWidth, h / this.imageElement.naturalHeight);
            const dw = this.imageElement.naturalWidth * scale;
            const dh = this.imageElement.naturalHeight * scale;
            const ox = (w - dw) / 2, oy = (h - dh) / 2;
            rect = { x: ox, y: oy, width: dw, height: dh };
            ctx.save();
            ctx.shadowColor = "rgba(28,35,64,0.12)";
            ctx.shadowBlur = 10;
            ctx.drawImage(this.imageElement, ox, oy, dw, dh);
            ctx.restore();
        } else {
            ctx.fillStyle = "#4b5470";
            ctx.font = "700 23px system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("Upload an assembly image to begin ROI mapping", w / 2, h / 2 - 8);
            ctx.font = "15px system-ui, sans-serif";
            ctx.fillText("Then select Draw ROI and drag a circle around each nut", w / 2, h / 2 + 22);
        }
        this.state.imageRect = rect;
        if (rect.width) {
            this.drawRois(ctx, rect);
            if (this.state.draftRoi) this.drawDraftRoi(ctx, this.state.draftRoi);
        }
    }

    drawRois(ctx, rect) {
        this.state.nuts.forEach((nut, index) => {
            const x = rect.x + nut.roi_x / 100 * rect.width;
            const y = rect.y + nut.roi_y / 100 * rect.height;
            const radius = Math.max(12, (nut.roi_r || 2.5) / 100 * Math.min(rect.width, rect.height));
            const colour = nut.status === "ok" ? "#22b04b" : nut.status === "nok" ? "#dc2626" : "#8a93ad";
            const selected = index === this.state.selectedIndex;
            const activeId = Array.isArray(this.state.assembly?.active_nut_id) ? this.state.assembly.active_nut_id[0] : false;
            const active = Boolean(nut.id && nut.id === activeId) || (this.state.assembly?.state === "running" && selected);
            ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fillStyle = colour + "24"; ctx.fill();
            if (selected) {
                ctx.beginPath(); ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
                ctx.lineWidth = 2; ctx.strokeStyle = "#2b2f8f"; ctx.stroke();
            }
            ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.lineWidth = active ? 5 : 3; ctx.strokeStyle = active ? "#f0a500" : colour; ctx.stroke();
            ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = colour; ctx.fill();
            const label = nut.name || `N-${String(index + 1).padStart(2, "0")}`;
            ctx.font = "700 15px system-ui, sans-serif";
            const labelWidth = ctx.measureText(label).width + 16;
            const labelY = y - radius - 12;
            ctx.fillStyle = selected ? "#2b2f8f" : colour;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x - labelWidth / 2, labelY - 17, labelWidth, 23, 5);
            else ctx.rect(x - labelWidth / 2, labelY - 17, labelWidth, 23);
            ctx.fill();
            ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.fillText(label, x, labelY - 1);
            if (active) {
                ctx.beginPath(); ctx.arc(x, y, radius + 9, 0, Math.PI * 2);
                ctx.setLineDash([5, 5]); ctx.lineWidth = 2; ctx.strokeStyle = "#f0a500"; ctx.stroke(); ctx.setLineDash([]);
            }
        });
    }

    drawDraftRoi(ctx, draft) {
        const radius = Math.max(2, draft.radius || 0);
        ctx.beginPath(); ctx.arc(draft.startX, draft.startY, radius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(43,47,143,0.12)"; ctx.fill();
        ctx.setLineDash([7, 5]); ctx.strokeStyle = "#2b2f8f"; ctx.lineWidth = 3; ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(draft.startX, draft.startY, 3, 0, Math.PI * 2); ctx.fillStyle = "#2b2f8f"; ctx.fill();
    }

    updateNut(field, ev) {
        const nut = this.selectedNut;
        if (!nut) return;
        const type = ev.target.type;
        const value = type === "number" ? Number(ev.target.value) : ev.target.value;
        nut[field] = value;
        if (["name", "roi_x", "roi_y", "roi_r"].includes(field)) this.drawCanvas();
        if (field === "sequence") {
            this.state.nuts.sort((a, b) => a.sequence - b.sequence || (a.id || 0) - (b.id || 0));
            this.state.selectedIndex = this.state.nuts.indexOf(nut);
        }
    }

    selectNut(index) {
        this.state.selectedIndex = index;
        this.state.interactionMode = "select";
        this.drawCanvas();
    }

    removeSelectedNut() {
        const nut = this.selectedNut;
        if (!nut) return;
        this.state.nuts.splice(this.state.selectedIndex, 1);
        this.state.selectedIndex = this.state.nuts.length ? Math.min(this.state.selectedIndex, this.state.nuts.length - 1) : -1;
        this.drawCanvas();
        this.notification.add(`${nut.name} removed from the unsaved mapping. Save Mapping to apply the change.`, { type: "warning" });
    }

    async saveAssembly() {
        if (!this.state.imageData) {
            this.notification.add("Upload an assembly image first.", { type: "warning" });
            return;
        }
        if (!this.state.nuts.length) {
            this.notification.add("Choose Draw ROI and drag a circle around at least one nut.", { type: "warning" });
            return;
        }
        const seenNames = new Set();
        for (const [index, nut] of this.state.nuts.entries()) {
            const name = String(nut.name || "").trim();
            if (!name) { this.notification.add(`Enter an ID for nut ${index + 1}.`, { type: "warning" }); return; }
            if (seenNames.has(name.toLowerCase())) { this.notification.add(`Nut ID ${name} is duplicated. Every nut must have a unique ID.`, { type: "warning" }); return; }
            seenNames.add(name.toLowerCase());
            if (Number(nut.torque_min) > Number(nut.torque_max) || Number(nut.angle_min) > Number(nut.angle_max)) {
                this.notification.add(`Check min/max torque and angle values for ${name}.`, { type: "warning" }); return;
            }
        }
        const encoded = this.state.imageData.split(",")[1];
        const assemblyValues = {
            name: String(this.state.assemblyName || this.state.imageName.replace(/\.[^.]+$/, "") || "New Assembly").trim(),
            image: encoded,
            image_filename: this.state.imageName,
            image_mimetype: this.state.imageMimeType,
            image_width: this.state.imageWidth,
            image_height: this.state.imageHeight,
        };
        let id = this.state.assemblyId;
        if (id) await this.orm.write("ntm.assembly", [id], assemblyValues);
        else id = (await this.orm.create("ntm.assembly", [assemblyValues]))[0];
        const payload = this.state.nuts.map((nut, index) => ({
            id: nut.id || false,
            name: String(nut.name || `N-${String(index + 1).padStart(2, "0")}`).trim(),
            sequence: Number(nut.sequence) || (index + 1) * 10,
            x: Number(nut.roi_x), y: Number(nut.roi_y), r: Number(nut.roi_r),
            arm_x: Number(nut.arm_x) || 0, arm_y: Number(nut.arm_y) || 0, arm_z: Number(nut.arm_z) || 0,
            encoder_position: Number(nut.encoder_position) || 0,
            target_torque: Number(nut.target_torque) || 10, torque_min: Number(nut.torque_min), torque_max: Number(nut.torque_max),
            target_angle: Number(nut.target_angle) || 90, angle_min: Number(nut.angle_min), angle_max: Number(nut.angle_max),
        }));
        await this.orm.call("ntm.assembly", "action_save_mapping", [[id], JSON.stringify(payload)]);
        this.state.assemblies = await this.orm.searchRead("ntm.assembly", [], ["name", "reference", "state"], { order: "write_date desc, id desc" });
        await this.loadAssembly(id);
        this.notification.add("Assembly image, ROI circles and nut parameters saved.", { type: "success" });
    }

    async runAction(method) {
        if (!this.state.assemblyId) {
            this.notification.add("Save the assembly mapping before running a cycle.", { type: "warning" });
            return;
        }
        if (this.state.nuts.some((nut) => !nut.id)) {
            this.notification.add("Save Mapping first so all drawn ROIs have database records.", { type: "warning" });
            return;
        }
        this.state.cycleBusy = true;
        try {
            await this.orm.call("ntm.assembly", method, [[this.state.assemblyId]]);
            await this.loadAssembly(this.state.assemblyId);
        } catch (error) {
            this.notification.add(error.message || "The cycle action failed.", { type: "danger" });
        } finally {
            this.state.cycleBusy = false;
        }
    }

    formatNumber(value, precision = 0) {
        // Called from the Owl template; keep numeric coercion in JavaScript,
        // not in the QWeb expression where Number may be unavailable.
        const numeric = Number(value);
        return (Number.isFinite(numeric) ? numeric : 0).toFixed(precision);
    }

    get selectedNut() { return this.state.nuts[this.state.selectedIndex] || null; }
    get okCount() { return this.state.nuts.filter((n) => n.status === "ok").length; }
    get nokCount() { return this.state.nuts.filter((n) => n.status === "nok").length; }
    get pendingCount() { return this.state.nuts.filter((n) => ["pending", "running"].includes(n.status)).length; }
    get progress() { return this.state.nuts.length ? Math.round(this.okCount / this.state.nuts.length * 100) : 0; }
    get cycleStatus() {
        const labels = { draft: "SETUP REQUIRED", mapped: "READY TO RUN", running: "IN PROGRESS", pass: "CYCLE PASS", fail: "CYCLE FAIL" };
        return labels[this.state.assembly?.state] || "NEW ASSEMBLY";
    }
    get currentMessage() { return this.state.assembly?.last_plc_message || "Simulator ready — no physical PLC connected"; }
}

registry.category("actions").add("ntm_roi_dashboard_v3", NtmLiveDashboard);
