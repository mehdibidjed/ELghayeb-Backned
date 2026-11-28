"""El Ghayeb - full 3D assembly: printed enclosure + electronics + wiring.

Loads ElGhayeb_Enclosure.py (same folder) for the printed parts, dimensions and geometry
helpers, then adds simplified models of the electronics and every wire, coloured like the
wiring diagram:
  red = 5V, black = GND, orange = GPIO18 (servo), yellow = GPIO10 (LED data),
  green = LED ring DIN, purple = camera ribbon, brown = servo cable.

The electronics are for checking fit and showing the wiring; only the 4 printed parts
(Shell, Back lid, Camera bracket, Wall bracket - which now carries the servo cradle)
are meant to be printed.
"""

import math
import os

import adsk.core
import adsk.fusion

HERE = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else None

COLORS = {
    'print': (225, 225, 220), 'pcb': (20, 110, 60), 'black': (30, 30, 30), 'metal': (185, 185, 190),
    'red': (220, 40, 40), 'gnd': (25, 25, 25), 'orange': (240, 130, 20), 'yellow': (240, 210, 30),
    'green': (40, 170, 70), 'purple': (130, 100, 220), 'brown': (120, 70, 35), 'blue': (40, 90, 200),
    'led': (250, 250, 245), 'lens': (20, 20, 40), 'cap': (30, 60, 140), 'servo': (40, 90, 200),
}


def build(ns):
    """Electronics in the camera frame (before tilt). Returns [(component, [(body, BRepBody, color)])]."""
    tb, box, cyl, cyl_y, cyl_z, union, P, cm = (ns[k] for k in ('tb', 'box', 'cyl', 'cyl_y', 'cyl_z', 'union', 'P', 'cm'))
    LENS_Z, D = ns['LENS_Z'], ns['D']
    pz = ns['WALL'] + ns['PI_STANDOFF_H']          # Pi PCB bottom
    pt = pz + 1.6                                   # Pi PCB top

    def sphere(p, d):
        return tb.createSphere(P(*p), cm(d / 2))

    def wire(points, d=1.2):
        body = cyl(points[0], points[1], d)
        for a, b in zip(points[1:], points[2:]):
            union(body, cyl(a, b, d))
        for p in points[1:-1]:
            union(body, sphere(p, d))
        return body

    def strip(p1, p2, wdir, width, thick=0.4):
        """Flat ribbon segment from p1 to p2, width along wdir."""
        v = adsk.core.Vector3D.create(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2])
        length = v.length
        v.normalize()
        w = adsk.core.Vector3D.create(*wdir)
        c = P((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (p1[2] + p2[2]) / 2)
        return tb.createBox(adsk.core.OrientedBoundingBox3D.create(c, v, w, cm(length), cm(width), cm(thick)))

    parts = []

    # ---- Raspberry Pi Zero W (SD card at +X, header at the front, ports at the back)
    y0 = ns['PI_Y0']
    pcb = box(-32.5, 32.5, y0, y0 + 30, pz, pt)
    for x in (-29.0, 29.0):
        for y in (y0 + 3.5, y0 + 26.5):
            ns['cut'](pcb, cyl_z(x, y, pz - 0.1, pt + 0.1, 2.75))
    pi = [('PCB', pcb, 'pcb'),
          ('SoC', box(-6, 6, y0 + 9, y0 + 21, pt, pt + 1.2), 'black'),
          ('Header', box(-25.4, 25.4, y0 + 1.0, y0 + 6.0, pt, pt + 2.5), 'black'),
          ('Mini HDMI', box(32.5 - 12.4 - 5.5, 32.5 - 12.4 + 5.5, y0 + 25, y0 + 30.5, pt, pt + 3.3), 'metal'),
          ('Micro USB', box(32.5 - 41.4 - 4, 32.5 - 41.4 + 4, y0 + 25, y0 + 30.8, pt, pt + 2.8), 'metal'),
          ('PWR', box(ns['PI_PWR_X'] - 4, ns['PI_PWR_X'] + 4, y0 + 25, y0 + 30.8, pt, pt + 2.8), 'metal'),
          ('SD card', box(32.5 - 12, 33.5, y0 + 10, y0 + 22, pz - 1.3, pz), 'metal'),
          ('CSI connector', box(-32.5, -28.5, y0 + 9, y0 + 21, pt, pt + 1.2), 'black')]
    # header pins: pin 1 at the SD-card end, even pins on the board-edge row
    def pin_xy(n):
        col = (n - 1) // 2
        return 24.13 - col * 2.54, (y0 + 2.23 if n % 2 == 0 else y0 + 4.77)
    pins = box(-25.4, 25.4, y0 + 1.6, y0 + 5.4, pt + 2.5, pt + 8.5)   # pin field
    pi.append(('Pins', pins, 'metal'))
    parts.append(('Pi Zero W', pi))

    # ---- Camera Module 3 (PCB behind the bracket, lens through the window)
    cam_top, cam_bot = LENS_Z + 9.5, LENS_Z - 14.5
    cy0 = ns['BR_Y0'] + ns['BR_T'] + 1.5            # PCB front face on the standoffs
    cam = [('PCB', box(-12.5, 12.5, cy0, cy0 + 1.0, cam_bot, cam_top), 'pcb'),
           ('Lens housing', box(-4.25, 4.25, cy0 - 6.0, cy0, LENS_Z - 4.25, LENS_Z + 4.25), 'black'),
           ('Lens', cyl_y(0, LENS_Z, 1.0, cy0 - 6.0, 7.0), 'lens'),
           ('Connector', box(-10, 10, cy0 + 1.0, cy0 + 3.5, cam_bot, cam_bot + 5.5), 'black')]
    parts.append(('Camera Module 3', cam))

    # ---- WS2812 ring (LEDs face the front wall holes)
    ring = cyl_y(0, LENS_Z, 3.6, 5.2, 37.0)
    ns['cut'](ring, cyl_y(0, LENS_Z, 3.5, 5.3, 23.0))
    leds = None
    for i in range(12):
        a = 2 * math.pi * i / 12
        x, z = 15 * math.cos(a), LENS_Z + 15 * math.sin(a)
        b = box(x - 2.5, x + 2.5, 2.05, 3.6, z - 2.5, z + 2.5)
        leds = b if leds is None else (union(leds, b) or leds)
    parts.append(('LED ring', [('PCB', ring, 'black'), ('LEDs', leds, 'led')]))

    # ---- Perfboard on the right wall: 74AHCT125, 330 ohm, 1000 uF
    pb = [('Board', box(41.0, 42.6, 14.0, 40.0, 14.0, 34.0), 'pcb'),
          ('74AHCT125', box(37.7, 41.0, 18.0, 37.0, 24.0, 30.4), 'black'),
          ('330R', cyl((40.0, 16.0, 20.0), (40.0, 16.0, 26.0), 2.4), 'blue'),
          ('1000uF', cyl((37.0, 26.0, 18.5), (37.0, 38.0, 18.5), 8.0), 'cap')]
    parts.append(('Perfboard', pb))

    # ---- SG90 servo + horn (base frame)
    sy = D / 2
    bx0 = -ns['SERVO_SHAFT_FROM_END']
    bx1 = bx0 + 22.5
    bcx = (bx0 + bx1) / 2
    zb = -11.0 - ns['SERVO_TAB_H']
    servo = box(bx0, bx1, sy - 6.1, sy + 6.1, zb, zb + 22.7)
    union(servo, box(bcx - 16.1, bcx + 16.1, sy - 6.1, sy + 6.1, -11.0, -8.5))
    union(servo, cyl_z(0, sy, zb + 22.7, zb + 26.0, 11.8))
    parts.append(('SG90 servo', [('Body', servo, 'servo'),
                                 ('Spline', cyl_z(0, sy, -1.3, 0.0, 4.8), 'black'),
                                 ('Horn', cyl_z(0, sy, 0.0, 1.1, 20.0), 'led')]))

    # ---- Wiring
    def pin_top(n):
        x, y = pin_xy(n)
        return (x, y, pt + 8.5)

    def dupont(n):
        x, y = pin_xy(n)
        return box(x - 1.25, x + 1.25, y - 1.25, y + 1.25, pt + 8.5, pt + 22.5)

    tgt = lambda y: (39.6, y, 32.6)           # pads on the perfboard
    wires = []
    for n, y_pad, col, label in ((2, 16.0, 'red', '5V pin 2'), (6, 19.0, 'gnd', 'GND pin 6'),
                                 (12, 22.0, 'orange', 'GPIO18 pin 12'), (19, 25.0, 'yellow', 'GPIO10 pin 19')):
        x, y, z = pin_top(n)
        wires.append((f'Dupont {label}', dupont(n), 'black'))
        wires.append((label, wire([(x, y, z + 14), (x, y, 36.0), (32.0, y_pad, 36.0), tgt(y_pad)]), col))
    # LED ring: 3 wires from the pads at the bottom of the ring, through the bracket notch,
    # along the free lane in front of the header, up to the perfboard.
    for dx, dz, y_pad, col, label in ((-1.5, 14.2, 30.0, 'red', 'Ring 5V'), (0.0, 15.4, 33.0, 'gnd', 'Ring GND'),
                                      (1.5, 16.6, 36.0, 'green', 'Ring DIN')):
        wires.append((label, wire([(dx, 5.2, dz), (dx, 9.9, dz), (30.0 + dx, 10.6, dz),
                                   (34.0 + dx, 14.0 + dx, 30.0), tgt(y_pad)], 1.0), col))
    # Servo cable: servo -> out of the cradle slot -> slack loop -> lid hole -> perfboard
    hx = ns['CABLE_HOLE_X']
    wires.append(('Servo cable', wire([(bx1, sy, zb + 4.0), (30.0, sy, zb + 4.0), (30.0, D + 14.0, -16.0),
                                       (hx, D + 10.0, 8.0), (hx, D - 1.0, 8.0), (38.5, 39.0, 30.0)], 3.0), 'brown'))
    # Camera ribbon: down from the camera connector, along the lane in front of the header,
    # then back to the CSI connector at the -X end of the Pi.
    # The lane is the 1.5 mm gap between the camera PCB back (Y 11.5) and the header (Y 13).
    ry, rz = 12.3, 13.0
    rib = strip((0.0, ry, cam_bot + 2.0), (0.0, ry, rz), (1, 0, 0), 16.0)
    union(rib, strip((8.0, ry, rz), (-33.5, ry, rz), (0, 0, 1), 9.0))
    union(rib, strip((-33.5, ry - 0.2, rz), (-33.5, y0 + 15.0, rz), (0, 0, 1), 9.0))
    union(rib, strip((-33.7, y0 + 15.0, pt + 0.6), (-28.5, y0 + 15.0, pt + 0.6), (0, 1, 0), 9.0))
    wires.append(('Camera ribbon', rib, 'purple'))
    parts.append(('Wiring', wires))
    return parts


def appearance(design, cache, key):
    if key in cache:
        return cache[key]
    app = adsk.core.Application.get()
    src = None
    for i in range(app.materialLibraries.count):
        lib = app.materialLibraries.item(i)
        if 'ppearance' not in lib.name:
            continue
        for j in range(lib.appearances.count):
            a = lib.appearances.item(j)
            if a.name.startswith('Plastic - Matte') or a.name.startswith('Paint - Enamel Glossy'):
                src = a
                break
        if src:
            break
    if src is None:
        cache[key] = None
        return None
    appr = design.appearances.itemByName(f'ElGhayeb {key}') or design.appearances.addByCopy(src, f'ElGhayeb {key}')
    for k in range(appr.appearanceProperties.count):
        prop = adsk.core.ColorProperty.cast(appr.appearanceProperties.item(k))
        if prop and prop.id in ('opaque_albedo', 'generic_diffuse', 'metal_f0', 'transparent_color', 'layered_diffuse'):
            prop.value = adsk.core.Color.create(*COLORS[key], 255)
    cache[key] = appr
    return appr


def add_component(root, design, name, bodies, cache):
    occ = root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
    comp = occ.component
    comp.name = name
    parametric = design.designType == adsk.fusion.DesignTypes.ParametricDesignType
    bf = None
    if parametric:
        bf = comp.features.baseFeatures.add()
        bf.startEdit()
    added = []
    for bname, body, col in bodies:
        b = comp.bRepBodies.add(body, bf) if parametric else comp.bRepBodies.add(body)
        added.append((b, bname, col))
    if parametric:
        bf.finishEdit()
    for i, (_, bname, col) in enumerate(added):
        b = comp.bRepBodies.item(i)
        b.name = bname
        appr = appearance(design, cache, col)
        if appr:
            b.appearance = appr
    return occ


def run(_context: str, enclosure_path=None):
    path = enclosure_path or os.path.join(HERE, 'ElGhayeb_Enclosure.py')
    ns = {'__name__': 'elghayeb_enclosure'}
    with open(path, encoding='utf-8') as f:
        exec(compile(f.read(), path, 'exec'), ns)

    app = adsk.core.Application.get()
    design = adsk.fusion.Design.cast(app.activeProduct)
    root = design.rootComponent
    cache = {}

    m = ns['tilt_matrix']()
    printed = [('Shell', ns['make_shell']()), ('Back lid', ns['make_lid']()),
               ('Camera bracket', ns['make_bracket']())]
    for _, b in printed:
        ns['tb'].transform(b, m)
    printed.append(('Wall bracket', ns['make_wall_bracket']()))
    for name, body in printed:
        add_component(root, design, name, [(name, body, 'print')], cache)

    for comp_name, bodies in build(ns):
        for _, b, _ in bodies:
            ns['tb'].transform(b, m)
        add_component(root, design, comp_name, bodies, cache)

    for occ in root.occurrences:
        print(occ.component.name, occ.component.bRepBodies.count, 'bodies')
    app.activeViewport.fit()
