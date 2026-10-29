# Odoo Nut Tightening Monitor

Independent Odoo 18 addon for image-based nut ROI mapping and simulated tightening validation.

## Features

- Upload a top-view assembly image.
- Draw circular ROI markers directly on the image using click-and-drag.
- Automatically assign nut IDs and tightening sequence numbers.
- Configure ROI coordinates, PLC/arm X/Y/Z positions, encoder counts, torque limits and angle limits.
- Visual pending/current/OK/NOK statuses and simulated tightening result history.
- Includes a demo motor-housing assembly with eight sample nut mappings and a synthetic SVG image.
- Uses an indigo/white MES-style interface, independently implemented without copying the original office Work Instruction stylesheet into this repository.

## One-time setup on Windows / Odoo 18

Stop Odoo first. Since an earlier ZIP version may already exist, keep it as a backup rather than deleting it. Run:

```powershell
cd "C:\Users\vegal\OneDrive\Desktop\odoo\odoo18\custom_addons"
if (Test-Path .\nut_tightening_monitor_v3) {
    Rename-Item .\nut_tightening_monitor_v3 .\nut_tightening_monitor_v3_backup
}
git clone https://github.com/adii87s/Odoo-Nut-Tightening-Monitor.git nut_tightening_monitor_v3
```

Install or update it in the test database:

```powershell
cd "C:\Users\vegal\OneDrive\Desktop\odoo\odoo18"
.\.venv\Scripts\python.exe .\odoo-bin -c ..\conf\odoo.conf -d nut_tightening_test -i nut_tightening_monitor_v3 --stop-after-init
```

Use `-u` instead of `-i` if the module is already installed:

```powershell
.\.venv\Scripts\python.exe .\odoo-bin -c ..\conf\odoo.conf -d nut_tightening_test -u nut_tightening_monitor_v3 --stop-after-init
```

Then restart Odoo and hard-refresh the browser with **Ctrl+F5**.

## Future updates

Stop Odoo and run this after new commits are pushed:

```powershell
cd "C:\Users\vegal\OneDrive\Desktop\odoo\odoo18\custom_addons\nut_tightening_monitor_v3"
git pull origin main

cd "C:\Users\vegal\OneDrive\Desktop\odoo\odoo18"
.\.venv\Scripts\python.exe .\odoo-bin -c ..\conf\odoo.conf -d nut_tightening_test -u nut_tightening_monitor_v3 --stop-after-init
```

Restart Odoo and use **Ctrl+F5** in the browser. No ZIP download is needed for future updates.

## Test workflow

1. Open **Nut Tightening Monitor → Assemblies & ROI Mapping**.
2. Open **Motor Housing Demo - 8 Nuts**, or create an assembly and upload a top-view photo.
3. Choose **Draw ROI**, then click and drag around a nut. Its next ID and sequence are assigned automatically.
4. Configure the selected nut's PLC/arm X/Y/Z positions, encoder count, torque limits and angle limits.
5. Select **Save Mapping**, then test with **Start Cycle**, **Simulate OK**, and **Simulate NOK**.

## Safety / hardware status

PLC and encoder values in this version are simulated examples only. Torque and angle limits are not calibrated for real machinery. Do not use this prototype to operate production equipment.

## Project layout

The repository root is the Odoo addon directory, so it can be cloned directly as `custom_addons/nut_tightening_monitor_v3`. It does not depend on or modify `control_plan_work_instruction`, PMS, QMS, or other office-only addons.
