{
    "name": "Nut Tightening Monitor - Work Instruction UI",
    "version": "18.0.3.0.1",
    "category": "Manufacturing",
    "summary": "Image-based nut ROI drawing, PLC arm-position setup and simulated tightening results",
    "description": "Nut mapping workflow aligned to the Control Plan Work Instruction MES workstation design. Upload an image, draw circular nut ROIs, assign sequence, then configure PLC positions and tightening limits.",
    "depends": ["base", "web"],
    "data": [
        "data/ntm_sequence.xml",
        "data/demo_assembly_data.xml",
        "security/ir.model.access.csv",
        "views/nut_monitor_views.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "nut_tightening_monitor_v3/static/src/js/nut_roi_dashboard.js",
            "nut_tightening_monitor_v3/static/src/xml/nut_roi_dashboard.xml",
            "nut_tightening_monitor_v3/static/src/css/nut_roi_dashboard.css",
        ],
    },
    "application": True,
    "installable": True,
    "license": "LGPL-3",
}
