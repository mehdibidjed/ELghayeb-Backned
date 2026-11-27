"""El Ghayeb - camera node enclosure (Raspberry Pi Zero W + Camera Module 3 + 12-LED WS2812 ring
+ SG90 or MG90S servo), wall mounted, tilted 15 deg down.

Run from Fusion: Utilities > Add-Ins > Scripts > + (or through the Fusion MCP server).
Builds 4 printed parts in the active design, all dimensions in mm (see PARAMETERS):

  1. Shell         90 x 60 x 45 box, open at the back: lens + 12 LED holes, engraved bezel,
                   honeycomb vents (top + left side), Pi Zero standoffs, camera bracket bosses,
                   lid screw bosses, servo horn mount underneath.
  2. Back lid      screws on the back: honeycomb, micro-USB power slot, servo cable hole.
  3. Cam bracket   holds the camera behind the LED ring (ring sits between the front wall and it).
  4. Wall bracket  wall plate (2 keyholes + 2 countersunk screws) and tilted shelf with the
                   servo cradle built in (fits SG90 and MG90S).

Camera frame: X = width (left/right), Y = depth (front face at Y=0, back at Y=45), Z = up.
The servo shaft is at X=0, Y=22.5, under the centre of the box floor (Z=0); the whole camera
assembly is then tilted by TILT about a pivot on the wall plate.
"""

import math

import adsk.core
import adsk.fusion

# ---------------------------------------------------------------- PARAMETERS (mm)
W, H, D = 90.0, 60.0, 45.0      # outer box: width (X), height (Z), depth (Y)
WALL = 1.6                      # wall / floor / lid thickness (4 perimeters of a 0.4 mm nozzle)
R_OUT = 10.0                    # rounded corners seen from the front
HEX_F, HEX_PITCH = 6.0, 7.6     # honeycomb: hexagon across flats, centre spacing (1.6 mm ribs)
BEZEL_D, BEZEL_DEPTH = 46.0, 0.6  # engraved ring around the lens + LEDs on the front face
LID_BOSS_IN = 5.0               # lid screw bosses: distance from the outer edges (must touch the rounded wall)
LENS_Z = 32.0                   # lens centre height
LENS_HOLE = 10.0                # front wall hole for the lens
LED_PCD, LED_N, LED_HOLE = 30.0, 12, 3.0   # 12-LED ring (OD 37 / ID 23): LED circle ~30 mm

# Camera Module 3 (25 x 24 mm, same holes as v2): holes relative to the lens centre.
CAM_HOLES = [(-10.5, 7.5), (10.5, 7.5), (-10.5, -5.0), (10.5, -5.0)]
CAM_WINDOW = 10.0               # square window in the bracket for the lens housing (8.5 mm)

# Camera bracket: plate behind the LED ring, screwed on two bosses of the front wall.
BR_Y0, BR_T = 7.0, 2.0          # bracket front face Y and thickness (ring gap = 7 - 2 = 5 mm)
BR_X, BR_Z0, BR_Z1 = 28.0, 14.0, 50.0
BOSS_X = 23.0                   # bracket bosses at X = +/-23 (clear of the 37 mm ring)

# Raspberry Pi Zero W: 65 x 30 mm, M2.5 holes 58 x 23, lying on the floor, components up,
# GPIO header along the front edge, ports along the back edge. Seen from above with the
# header at the front, the SD card is on the right (+X), so the ports run right to left:
# mini-HDMI, USB, PWR.
PI_Y0 = 12.0                    # board front edge
PI_STANDOFF_H = 4.0
PI_PWR_X = 32.5 - 54.0          # micro-USB PWR connector (54 mm from the SD-card end)
CABLE_HOLE_X = 21.0             # lid hole for the servo cable (opposite side from the power plug)

# Servo: fits an SG90 (22.5 x 12.2, plastic gears) or an MG90S (22.8 x 12.2, metal gears).
# The servo hangs by its tabs on the cradle top; the pocket is open at the bottom so a body
# taller below the tabs (MG90S) still fits. The tab holes are slots for both hole spacings.
SERVO_L, SERVO_W = 23.3, 12.8   # body pocket with clearance for both
SERVO_SLOT = 0.6                # tab-hole slots: +/-0.6 mm around the 27.5 mm spacing
SERVO_SHAFT_FROM_END = 5.9
SERVO_TAB_HOLES = 27.5
SERVO_TAB_H = 16.0              # body height under the mounting tabs
HORN_D, HORN_DEPTH = 21.0, 1.2

# Wall bracket (L shape): the camera hangs above the board and looks down at the class.
# At 2.40 m, a level camera (vertical FOV ~41 deg) would miss the first ~3 m of rows;
# tilting it 15 deg down covers from ~1.7 m to the back of an 8 m room.
TILT = 15.0                     # downward tilt of the whole camera, degrees (0 = level)
WALL_Y = 85.0                   # front face of the wall plate (clears the box and USB plug at +/-40 deg pan)
WALL_T = 4.0                    # wall plate thickness
WALL_X = 32.0                   # half width of the wall plate
WALL_Z0, WALL_Z1 = -85.0, 25.0  # wall plate bottom / top
SHELF_T = 4.0
SHELF_X = 24.0                  # half width of the shelf (the servo cradle is part of it)
KEYHOLE_X, KEYHOLE_Z = 24.0, 10.0   # 2 keyholes at the top (hang on screws first)
FIX_X, FIX_Z = 26.0, -75.0          # 2 countersunk screws at the bottom (5 mm wood screws)

EPS = 0.2                       # cut overshoot


def cm(v):
    return v / 10.0


tb = adsk.fusion.TemporaryBRepManager.get()


def P(x, y, z):
    return adsk.core.Point3D.create(cm(x), cm(y), cm(z))


def box(x0, x1, y0, y1, z0, z1):
    obb = adsk.core.OrientedBoundingBox3D.create(
        P((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2),
        adsk.core.Vector3D.create(1, 0, 0),
        adsk.core.Vector3D.create(0, 1, 0),
        cm(abs(x1 - x0)), cm(abs(y1 - y0)), cm(abs(z1 - z0)),
    )
    return tb.createBox(obb)


def cyl(p1, p2, d):
    return tb.createCylinderOrCone(P(*p1), cm(d / 2), P(*p2), cm(d / 2))


def cyl_y(x, z, y0, y1, d):
    return cyl((x, y0, z), (x, y1, z), d)


def cyl_z(x, y, z0, z1, d):
    return cyl((x, y, z0), (x, y, z1), d)


def union(target, *tools):
    for t in tools:
        if not tb.booleanOperation(target, t, adsk.fusion.BooleanTypes.UnionBooleanType):
            raise RuntimeError('union failed')
    return target


def cut(target, *tools):
    for t in tools:
        if not tb.booleanOperation(target, t, adsk.fusion.BooleanTypes.DifferenceBooleanType):
            raise RuntimeError('cut failed')
    return target


def rounded_prism_y(x0, x1, z0, z1, y0, y1, r):
    """Box along Y whose 4 edges parallel to Y are rounded with radius r."""
    body = box(x0 + r, x1 - r, y0, y1, z0, z1)
    union(body, box(x0, x1, y0, y1, z0 + r, z1 - r))
    for x in (x0 + r, x1 - r):
        for z in (z0 + r, z1 - r):
            union(body, cyl_y(x, z, y0, y1, 2 * r))
    return body


def hex_prism(c, axis, u, f, depth):
    """Hexagonal prism (across flats f) centred at c, axis along `axis`, two flats facing +/-u."""
    ax = adsk.core.Vector3D.create(*axis)
    u0 = adsk.core.Vector3D.create(*u)
    w0 = ax.crossProduct(u0)
    body = None
    for k in range(3):
        a = math.radians(60 * k)
        uk = adsk.core.Vector3D.create(u0.x * math.cos(a) + w0.x * math.sin(a),
                                       u0.y * math.cos(a) + w0.y * math.sin(a),
                                       u0.z * math.cos(a) + w0.z * math.sin(a))
        b = tb.createBox(adsk.core.OrientedBoundingBox3D.create(P(*c), ax, uk, cm(depth), cm(f), cm(2 * f)))
        if body is None:
            body = b
        elif not tb.booleanOperation(body, b, adsk.fusion.BooleanTypes.IntersectionBooleanType):
            raise RuntimeError('hex intersection failed')
    return body


def honeycomb(target, plane_pt, axis, u, v, a0, a1, b0, b1, depth, f=None, pitch=None):
    """Cut a honeycomb through a flat wall. (a, b) are coordinates along u and v from plane_pt;
    only whole hexagons inside [a0, a1] x [b0, b1] are cut."""
    f = f or HEX_F
    pitch = pitch or HEX_PITCH
    half_a, half_b = f / 2, f / math.sqrt(3)       # half extents of one hexagon along u and v
    row, n = 0, 0
    b = b0 + half_b
    while b <= b1 - half_b + 1e-6:
        a = a0 + half_a + (pitch / 2 if row % 2 else 0)
        while a <= a1 - half_a + 1e-6:
            c = tuple(plane_pt[i] + a * u[i] + b * v[i] for i in range(3))
            cut(target, hex_prism(c, axis, u, f, depth))
            n += 1
            a += pitch
        b += pitch * math.sqrt(3) / 2
        row += 1
    return n


# ---------------------------------------------------------------- parts
def make_shell():
    hx = W / 2
    shell = rounded_prism_y(-hx, hx, 0, H, 0, D, R_OUT)
    cut(shell, rounded_prism_y(-hx + WALL, hx - WALL, WALL, H - WALL, WALL, D + EPS, R_OUT - WALL))

    # Front: engraved bezel ring (1 mm groove, prints face-down without a bridge), lens + LED holes
    groove = cyl_y(0, LENS_Z, -EPS, BEZEL_DEPTH, BEZEL_D)
    cut(groove, cyl_y(0, LENS_Z, -2 * EPS, BEZEL_DEPTH + EPS, BEZEL_D - 2.0))
    cut(shell, groove)
    cut(shell, cyl_y(0, LENS_Z, -EPS, WALL + EPS, LENS_HOLE))
    for i in range(LED_N):
        a = 2 * math.pi * i / LED_N
        cut(shell, cyl_y(LED_PCD / 2 * math.cos(a), LENS_Z + LED_PCD / 2 * math.sin(a), -EPS, WALL + EPS, LED_HOLE))

    # Bracket bosses on the inside of the front wall (M2.5 self-tapping)
    for x in (-BOSS_X, BOSS_X):
        union(shell, cyl_y(x, LENS_Z, WALL - 0.5, BR_Y0, 6.0))
        cut(shell, cyl_y(x, LENS_Z, WALL + 0.8, BR_Y0 + EPS, 2.2))

    # Pi Zero standoffs (holes 58 x 23)
    for x in (-29.0, 29.0):
        for y in (PI_Y0 + 3.5, PI_Y0 + 26.5):
            union(shell, cyl_z(x, y, WALL - 0.5, WALL + PI_STANDOFF_H, 5.0))
            cut(shell, cyl_z(x, y, WALL + 0.5, WALL + PI_STANDOFF_H + EPS, 2.2))

    # Lid screw bosses in the 4 back corners
    for x in (-(hx - LID_BOSS_IN), hx - LID_BOSS_IN):
        for z in (LID_BOSS_IN, H - LID_BOSS_IN):
            union(shell, cyl_y(x, z, D - 7.0, D, 7.0))
            # 45 deg cone under the boss: the shell prints face-down, so the boss end would hang
            union(shell, tb.createCylinderOrCone(P(x, D - 7.0 - 3.4, z), cm(0.1), P(x, D - 7.0 + 0.01, z), cm(3.5)))
            cut(shell, cyl_y(x, z, D - 6.0, D + EPS, 2.5))

    # Honeycomb: top (vents) and left side (the right side stays solid for the perfboard)
    honeycomb(shell, (0, 0, H - WALL / 2), (0, 0, 1), (1, 0, 0), (0, 1, 0), -27.0, 27.0, 10.0, 36.0, WALL + 2 * EPS)
    honeycomb(shell, (-hx + WALL / 2, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1), 9.0, 36.0, 13.0, 49.0, WALL + 2 * EPS)

    # Servo horn mount under the floor: recess + centre screw access + 2 horn screw holes
    sy = D / 2
    cut(shell, cyl_z(0, sy, -EPS, HORN_DEPTH, HORN_D))
    cut(shell, cyl_z(0, sy, -EPS, WALL + EPS, 3.5))
    for x in (-7.0, 7.0):
        cut(shell, cyl_z(x, sy, -EPS, WALL + EPS, 1.5))
    return shell


def make_lid():
    hx = W / 2
    lid = rounded_prism_y(-hx, hx, 0, H, D, D + WALL, R_OUT)
    for x in (-(hx - LID_BOSS_IN), hx - LID_BOSS_IN):
        for z in (LID_BOSS_IN, H - LID_BOSS_IN):
            cut(lid, cyl_y(x, z, D - EPS, D + WALL + EPS, 3.2))
    honeycomb(lid, (0, D + WALL / 2, 0), (0, 1, 0), (1, 0, 0), (0, 0, 1), -32.0, 32.0, 17.0, 48.0, WALL + 2 * EPS)
    # micro-USB power plug (overmould ~11 x 7.5)
    pz = WALL + PI_STANDOFF_H + 1.6 + 1.5
    cut(lid, box(PI_PWR_X - 6.5, PI_PWR_X + 6.5, D - EPS, D + WALL + EPS, pz - 4.5, pz + 4.5))
    # servo cable
    cut(lid, cyl_y(CABLE_HOLE_X, 8.0, D - EPS, D + WALL + EPS, 6.0))
    return lid


def make_bracket():
    y0, y1 = BR_Y0, BR_Y0 + BR_T
    br = box(-BR_X, BR_X, y0, y1, BR_Z0, BR_Z1)
    for x in (-BOSS_X, BOSS_X):
        cut(br, cyl_y(x, LENS_Z, y0 - EPS, y1 + EPS, 2.7))
    h = CAM_WINDOW / 2
    cut(br, box(-h, h, y0 - EPS, y1 + EPS, LENS_Z - h, LENS_Z + h))
    # camera standoffs on the back face (M2)
    for dx, dz in CAM_HOLES:
        union(br, cyl_y(dx, LENS_Z + dz, y1 - 0.5, y1 + 1.5, 4.5))
        cut(br, cyl_y(dx, LENS_Z + dz, y0 - EPS, y1 + 1.5 + EPS, 1.8))
    # notch for the LED ring wires
    cut(br, box(-4.0, 4.0, y0 - EPS, y1 + EPS, BR_Z0 - EPS, BR_Z0 + 4.0))
    return br


def tilt_matrix():
    """Rotation of the camera assembly: front goes down by TILT, pivot on the wall at the shelf top."""
    m = adsk.core.Matrix3D.create()
    m.setToRotation(math.radians(TILT), adsk.core.Vector3D.create(1, 0, 0), P(0, WALL_Y, -30.0))
    return m


def make_wall_bracket():
    """Wall plate + tilted shelf with the SG90 cradle built in (no separate servo base, no M4 bolts)."""
    sy = D / 2
    z_top = -11.0                                      # servo tabs rest here
    shelf_top = z_top - SERVO_TAB_H                    # servo bottom rests on the shelf
    bx0 = -SERVO_SHAFT_FROM_END
    bx1 = bx0 + SERVO_L
    cx = (bx0 + bx1) / 2

    # Shelf, cradle and 2 ribs, built in the camera frame then tilted with it.
    shelf = box(-SHELF_X, SHELF_X, 10.0, WALL_Y + 2.0, shelf_top - SHELF_T, shelf_top)
    union(shelf, box(cx - 17, cx + 17, sy - 8.75, sy + 8.75, shelf_top - 0.5, z_top))
    # 45 deg gusset behind the cradle: the bracket prints back-down, and without it the cradle's
    # back face (34 x 16 mm) would hang in the air.
    h = z_top - shelf_top
    gy = sy + 8.75
    gusset = box(cx - 17, cx + 17, gy - 0.5, gy + h, shelf_top - 0.5, z_top)
    d = adsk.core.Vector3D.create(0, 1, -1)
    d.normalize()
    n = adsk.core.Vector3D.create(1, 0, 0).crossProduct(d)          # (0, .707, .707): the side to remove
    cut(gusset, tb.createBox(adsk.core.OrientedBoundingBox3D.create(
        P(0, gy + d.y * 8 + n.y * 30, z_top + d.z * 8 + n.z * 30),
        adsk.core.Vector3D.create(1, 0, 0), d, cm(100), cm(80), cm(60))))
    union(shelf, gusset)
    cut(shelf, box(bx0, bx1, sy - SERVO_W / 2, sy + SERVO_W / 2, shelf_top - SHELF_T - EPS, z_top + EPS))
    hcx = bx0 + 22.5 / 2                                # tab holes are centred on the servo body, not the pocket
    for x in (hcx - SERVO_TAB_HOLES / 2, hcx + SERVO_TAB_HOLES / 2):
        s = SERVO_SLOT if x > hcx else -SERVO_SLOT
        cut(shelf, cyl_z(x, sy, z_top - 6.0, z_top + EPS, 1.8))
        cut(shelf, cyl_z(x + s, sy, z_top - 6.0, z_top + EPS, 1.8))
        cut(shelf, box(min(x, x + s), max(x, x + s), sy - 0.9, sy + 0.9, z_top - 6.0, z_top + EPS))
    cut(shelf, box(bx1 - 1, cx + 17 + EPS, sy - 3.5, sy + 3.5, shelf_top, shelf_top + 7.0))       # servo cable exit
    cut(shelf, box(-12.0, 12.0, gy + h + 1.0, WALL_Y - 8.0, shelf_top - SHELF_T - EPS, shelf_top + EPS))  # lightening window, past the gusset
    # Triangular ribs: full 15 mm deep at the wall, nothing at Y=50.
    rb = shelf_top - SHELF_T
    ribs = None
    for x in (-15.0, 15.0):
        r = box(x - 2.0, x + 2.0, 50.0, WALL_Y + 2.0, rb - 15.0, rb + 0.5)
        ribs = r if ribs is None else union(ribs, r)
    d = adsk.core.Vector3D.create(0, WALL_Y - 50.0, -15.0)
    d.normalize()
    n = adsk.core.Vector3D.create(1, 0, 0).crossProduct(d)          # points up/back, away from the rib
    a = (50.0, rb)
    ctr = P(0, a[0] + d.y * 40 - n.y * 30, a[1] + d.z * 40 - n.z * 30)
    cut(ribs, tb.createBox(adsk.core.OrientedBoundingBox3D.create(
        ctr, adsk.core.Vector3D.create(1, 0, 0), d, cm(100), cm(120), cm(60))))
    union(shelf, ribs)
    tb.transform(shelf, tilt_matrix())

    # Wall plate (rounded corners), vertical in world coordinates.
    y0, y1 = WALL_Y, WALL_Y + WALL_T
    bracket = rounded_prism_y(-WALL_X, WALL_X, WALL_Z0, WALL_Z1, y0, y1, 6.0)
    union(bracket, shelf)
    cut(bracket, box(-WALL_X - 10, WALL_X + 10, y1, y1 + 60, WALL_Z0 - 60, WALL_Z1 + 60))   # nothing behind the wall face
    # Honeycomb in the plate (clear of the shelf joint, the ribs, the keyholes and the screws)
    yc = (y0 + y1) / 2
    hc = lambda a0, a1, b0, b1: honeycomb(bracket, (0, yc, 0), (0, 1, 0), (1, 0, 0), (0, 0, 1), a0, a1, b0, b1, WALL_T + 2 * EPS)
    hc(-16.0, 16.0, 2.0, 18.0)        # between the keyholes
    hc(-28.0, 28.0, -18.0, 0.0)       # full width under the keyholes, above the shelf joint
    hc(-28.0, 28.0, -67.0, -48.0)     # under the ribs, above the fixing screws

    # Keyholes: head hole 9 mm, slot 4.5 mm upwards, pocket on the wall side for the screw head.
    for x in (-KEYHOLE_X, KEYHOLE_X):
        cut(bracket, cyl_y(x, KEYHOLE_Z, y0 - EPS, y1 + EPS, 9.0))
        cut(bracket, box(x - 2.25, x + 2.25, y0 - EPS, y1 + EPS, KEYHOLE_Z, KEYHOLE_Z + 10.0))
        cut(bracket, cyl_y(x, KEYHOLE_Z + 10.0, y0 - EPS, y1 + EPS, 4.5))
        cut(bracket, box(x - 4.5, x + 4.5, y1 - 2.5, y1 + EPS, KEYHOLE_Z, KEYHOLE_Z + 10.0))
        cut(bracket, cyl_y(x, KEYHOLE_Z + 10.0, y1 - 2.5, y1 + EPS, 9.0))
    # Countersunk fixing screws at the bottom.
    for x in (-FIX_X, FIX_X):
        cut(bracket, cyl_y(x, FIX_Z, y0 - EPS, y1 + EPS, 5.0))
        cut(bracket, tb.createCylinderOrCone(P(x, y0 - EPS, FIX_Z), cm(5.0), P(x, y0 + 2.5, FIX_Z), cm(2.5)))
    return bracket


# ---------------------------------------------------------------- build
def add_part(root, design, name, body):
    occ = root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
    comp = occ.component
    comp.name = name
    if design.designType == adsk.fusion.DesignTypes.ParametricDesignType:
        bf = comp.features.baseFeatures.add()
        bf.startEdit()
        b = comp.bRepBodies.add(body, bf)
        bf.finishEdit()
    else:
        b = comp.bRepBodies.add(body)
    b.name = name
    return comp


def run(_context: str):
    app = adsk.core.Application.get()
    design = adsk.fusion.Design.cast(app.activeProduct)
    root = design.rootComponent

    parts = [
        ('Shell', make_shell()),
        ('Back lid', make_lid()),
        ('Camera bracket', make_bracket()),
    ]
    m = tilt_matrix()
    for _, body in parts:
        tb.transform(body, m)
    parts.append(('Wall bracket', make_wall_bracket()))

    lens = P(0, 0, LENS_Z)
    lens.transformBy(m)
    print(f'Lens centre is {round(lens.z * 10 - FIX_Z, 1)} mm above the bottom screws, '
          f'{round(WALL_Y - lens.y * 10, 1)} mm out from the wall; tilt {TILT} deg down')
    for name, body in parts:
        comp = add_part(root, design, name, body)
        b = comp.bRepBodies.item(0)
        bb = b.boundingBox
        size = [round((bb.maxPoint.x - bb.minPoint.x) * 10, 1),
                round((bb.maxPoint.y - bb.minPoint.y) * 10, 1),
                round((bb.maxPoint.z - bb.minPoint.z) * 10, 1)]
        print(f'{name}: {size[0]} x {size[1]} x {size[2]} mm, volume {round(b.volume, 2)} cm3, solid={b.isSolid}')
    app.activeViewport.fit()
