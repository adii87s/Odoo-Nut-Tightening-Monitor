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
