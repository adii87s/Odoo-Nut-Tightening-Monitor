# Odoo Nut Tightening Monitor

Independent Odoo 18 addon for image-based nut ROI mapping and simulated tightening validation.

## Features

- Upload a top-view assembly image.
- Draw circular ROI markers directly on the image by clicking and dragging.
- Auto-assign nut IDs and sequence numbers.
- Configure ROI coordinates, PLC/arm X/Y/Z, encoder counts, torque limits and angle limits.
- Visual pending/current/OK/NOK states and simulated tightening result history.
- Demo image and sample assembly data for local tests.
- Separate addon; does not merge or modify the office Work Instruction module.

## Install

Copy the `nut_tightening_monitor_v3` folder into your Odoo custom addons path.

First install:
```powershell
cd "C:\Users\vegal\OneDrive\Desktop\odoo\odoo18"
.\.venv\Scripts\python.exe .\odoo-bin -c ..\conf\odoo.conf -d nut_tightening_test -i nut_tightening_monitor_v3 --stop-after-init
```

Update after pulling new commits:
```powershell
cd "C:\Users\vegal\OneDrive\Desktop\odoo\odoo18\custom_addons\nut_tightening_monitor_v3"
git pull origin main
cd "C:\Users\vegal\OneDrive\Desktop\odoo\odoo18"
.\.venv\Scripts\python.exe .\odoo-bin -c ..\conf\odoo.conf -d nut_tightening_test -u nut_tightening_monitor_v3 --stop-after-init
```

Restart Odoo and hard refresh the browser (Ctrl+F5) after an update.

## Test

1. Open **Nut Tightening Monitor → Assemblies & ROI Mapping**.
2. Open the demo assembly or create an assembly and upload an image.
3. Choose **Draw ROI**, then click and drag around each nut.
4. Configure arm/PLC positions, encoder, torque and angle thresholds.
5. Save the mapping and test with simulated OK/NOK results.

## Hardware note

This version uses simulated PLC/encoder values only. Demo positions and limits are examples, not calibrated production values. Do not use them to operate real machinery.
