# Camera node enclosure (3D printed)

Wall-mounted housing for the El Ghayeb camera node: **Raspberry Pi Zero W**, **Camera Module 3**,
**12-LED WS2812 ring** and an **SG90 / MG90S servo** for the left / centre / right scan (−40° / 0° / +40°).
It hangs above the board at 2.40 m, tilted **15° down** so the camera sees from about 1.7 m to the back of an 8 m room.

```
creality/ ElGhayeb_enclosure_Ender-3_V3_KE_PETG.3mf   ready-to-slice Creality Print project
stl/      4 printed parts, already oriented for printing
fusion/   ElGhayeb_camera_node.f3d   full assembly: printed parts + electronics + wiring
          ElGhayeb_Enclosure.py      script that builds the printed parts (all dimensions are parameters)
          ElGhayeb_Assembly.py       script that builds the full assembly (loads the one above)
```

## Parts

| File | Size (mm) | Bed side | Walls | Infill |
|---|---|---|---|---|
| `1_Shell.stl` | 90 × 60 × 45 | front face | 3 | 15 % gyroid |
| `2_Back_lid.stl` | 90 × 60 × 1.6 | outer face | 3 | 15 % gyroid |
| `3_Camera_bracket.stl` | 56 × 36 × 3.5 | front face | 3 | 15 % gyroid |
| `4_Wall_bracket_with_servo_cradle.stl` | 64 × 110 × 78 | wall side | **4** | **30 %** gyroid |

About **81 g of PETG**, 3 h 55 min on an Ender-3 V3 KE (0.4 nozzle, 0.20 mm layers).
**No supports**: every overhang is ≤ 45° or a short bridge (longest: 23 mm, top of the servo pocket).

### Creality Print project (Ender-3 V3 KE)
`creality/ElGhayeb_enclosure_Ender-3_V3_KE_PETG.3mf` opens in Creality Print 7.3 with everything set:
Creality Ender-3 V3 KE 0.4 nozzle · *0.20mm Standard* · *CR-PETG* (230 °C / 70 °C) · 3 walls, 15 % gyroid.

- Plate 1: shell, back lid, camera bracket.
- Plate 2: wall bracket (per-object: 4 walls, 30 % infill).
- Tree supports are switched on for the shell and the wall bracket in this project. The geometry prints without
  them (see above), so you can untick *Enable support* on those two objects to save filament and time.

### PETG settings
Nozzle 235–245 °C · bed 75–85 °C · fan 30–50 % (100 % on bridges) · glue stick on smooth PEI ·
dry the filament if it strings (65 °C, 4–6 h) · "avoid crossing perimeters" on, because of the honeycomb.

## Hardware

| Item | Qty |
|---|---|
| Raspberry Pi Zero W + Zero camera cable (22 → 15 pin) | 1 |
| Raspberry Pi Camera Module 3 (25 × 24 mm) | 1 |
| WS2812 ring, 12 LEDs (OD 37 mm) | 1 |
| SG90 or MG90S servo (the cradle fits both) | 1 |
| 74AHCT125 level shifter, 330 Ω resistor, 1000 µF / 10 V capacitor, small perfboard | 1 each |
| M2.5 self-tapping screws: 4 Pi standoffs, 2 camera bracket, 4 back lid | 10 |
| M2 screws for the camera | 4 |
| 5 mm wood screws + wall plugs | 4 |
| 5 V / 2.5 A micro-USB power supply | 1 |

## Wiring (Pi header, physical pin numbers)

| Pi pin | To |
|---|---|
| 2 (5 V) | servo red, ring 5 V, 74AHCT125 VCC (14) |
| 6 (GND) | servo brown, ring GND, 74AHCT125 GND (7) and 1OE (1) |
| 12 (GPIO18) | servo signal (orange) — hardware PWM / pigpio |
| 19 (GPIO10, SPI MOSI) | 74AHCT125 1A (2) → 1Y (3) → 330 Ω → ring DIN |
| CSI | camera, ribbon contacts facing the PCB on both ends |

1000 µF across 5 V / GND at the servo connector. Enable SPI (`raspi-config`); LED brightness ~30 %.
The 74AHCT125, resistor and capacitor sit on the perfboard taped to the inside of the right wall
(the left wall has the honeycomb). `fusion/ElGhayeb_camera_node.f3d` shows every wire route.

## Assembly

1. Servo into the cradle from the top, **shaft towards the middle of the shelf** (the SG90 shaft is 5.9 mm from one end, so the pocket is off-centre on purpose). Screw the tabs.
2. Servo at 0°. Screw the horn under the shell floor, press the shell onto the spline, centre screw from inside — **before** the Pi goes in (the Pi covers the hole).
3. LED ring against the inside of the front wall (LEDs in the 12 holes), then the camera bracket on its 2 bosses, camera on the bracket.
4. Perfboard on the right wall, wiring as above, Pi on its standoffs, camera ribbon.
5. Back lid (4 screws). Power cable through the slot, servo cable through the hole with a ~10 cm slack loop for ±40°.

### Wall mounting
- 2 keyholes at **2.40 m**, **48 mm** apart: hang the bracket, slide it down.
- 2 countersunk screws at **2.315 m**, **52 mm** apart.
- Lens centre ≈ 103 mm above the lower screws and ≈ 98 mm out from the wall.

## Changing the design

Open Fusion → *Utilities → Scripts and Add-Ins* → add `fusion/ElGhayeb_Assembly.py` (or `ElGhayeb_Enclosure.py`
for the printed parts only) in an empty design. Every dimension is a parameter at the top of
`ElGhayeb_Enclosure.py`: `TILT`, `WALL`, `HEX_F`/`HEX_PITCH`, `SERVO_SHAFT_FROM_END`, `LENS_Z`, wall plate size and screw
positions. Measure your own servo and camera with calipers before printing: shaft-to-end distance and the camera
hole positions (±10.5 mm, +7.5 / −5 mm from the lens) are the values most likely to differ.

Checked on the model: no part touches another during the ±40° pan (≥ 10 mm from the wall), no electronic part or
wire clashes with a printed part, every printed part is a single solid. The SG90 needs ~0.18 kg·cm of its 1.8 kg·cm
to swing the 72 g moving part; an MG90S (metal gears) is the better choice for daily use.
