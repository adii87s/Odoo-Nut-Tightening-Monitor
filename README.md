# Odoo Nut Tightening Monitor

An independent Odoo 18 addon for image-based nut ROI mapping and simulated tightening validation.

## Features

- Upload a top-view assembly image.
- Draw circular ROI markers directly on the image by clicking and dragging.
- Automatically assign nut IDs and tightening sequence numbers.
- Configure ROI coordinates, PLC/arm X/Y/Z positions, encoder counts, torque limits and angle limits.
- Visual pending/current/OK/NOK statuses and simulated tightening result history.
- Includes a demo motor-housing assembly with eight sample nut mappings.
- Uses an indigo/white MES-style interface while remaining independent of the office Control Plan Work Instruction addon.

## Install into a local Odoo setup

Open PowerShell and go to your custom addons folder:

```powershell
cd "C:\Users\vegal\OneDrive\Desktop\odoo\odoo18\custom_addons"
git clone https://github.com/adii87s/Odoo-Nut-Tightening-Monitor.git nut_tightening_monitor_v3
```

Then install the module into the test database:

```powershell
cd "C:\Users\vegal\OneDrive\Desktop\odoo\odoo18"
.\.venv\Scripts\python.exe .\odoo-bin -c ..\conf\odoo.conf -d nut_tightening_test -i nut_tightening_monitor_v3 --stop-after-init
```

## Update after new commits

Stop Odoo, then run:

```powershell
cd "C:\Users\vegal\OneDrive\Desktop\odoo\odoo18\custom_addons\nut_tightening_monitor_v3"
git pull origin main

cd "C:\Users\vegal\OneDrive\Desktop\odoo\odoo18"
.\.venv\Scripts\python.exe .\odoo-bin -c ..\conf\odoo.conf -d nut_tightening_test -u nut_tightening_monitor_v3 --stop-after-init
```

Restart Odoo and hard-refresh the browser with **Ctrl+F5**.

## Test workflow

1. Open **Nut Tightening Monitor → Assemblies & ROI Mapping**.
2. Open **Motor Housing Demo - 8 Nuts**, or create an assembly and upload a top-view photo.
3. Choose **Draw ROI**, then click and drag around a nut. The next nut ID and sequence are assigned automatically.
4. Configure the selected nut's PLC/arm X/Y/Z positions, encoder count, torque limits and angle limits.
5. Select **Save Mapping**, then test the cycle using **Start Cycle**, **Simulate OK**, and **Simulate NOK**.

## Safety / hardware status

PLC and encoder values in this version are simulated examples only. Torque and angle limits are not calibrated for real machinery. Do not use this prototype to operate production equipment.

## Project structure

The repository root is the Odoo addon directory, so it can be cloned directly as `custom_addons/nut_tightening_monitor_v3`. It does not depend on or modify `control_plan_work_instruction`, PMS, QMS, or other office-only addons.
