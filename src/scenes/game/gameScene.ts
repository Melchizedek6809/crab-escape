import { type GameObjects, Input, Scene } from 'phaser';

import level1 from '../../../assets/maps/1.json';
import level2 from '../../../assets/maps/2.json';
import level3 from '../../../assets/maps/3.json';
import level4 from '../../../assets/maps/4.json';
import type { UIScene } from '../ui/uiScene';

// A single tile layer as exported by Tiled with base64 encoding.
type TiledLayer = {
    name: string;
    type: string;
    encoding: string;
    data: string;
    width: number;
    height: number;
};

// The subset of the Tiled map format we actually care about.
type TiledMap = {
    width: number;
    height: number;
    tilewidth: number;
    tileheight: number;
    layers: TiledLayer[];
};

// A crab is two tiles long. x/y are its top-left tile; a horizontal crab also
// covers (x + 1, y) and moves left/right, a vertical crab also covers
// (x, y + 1) and moves up/down. The perpendicular axis cycles between crabs.
type Orientation = 'horizontal' | 'vertical';
type Crab = {
    x: number;
    y: number;
    orientation: Orientation;
    hasKey: boolean;
    sprite: GameObjects.Sprite;
    // The in-flight motion tween, if any, so it can be cancelled/re-aimed.
    tween?: Phaser.Tweens.Tween;
};

// Global tile ids (gids) as exported by Tiled. firstgid is 1 in main.tsx, so
// gid === tileId + 1.
const GID = {
    door: 2,
    exit: 3,
    floor: 4,
    wall: 6,
    key: 7,
    start: 8,
    // Decorative diagonal corner pieces, one per corner of the wall border.
    diagonalNE: 9,
    diagonalNW: 10,
    diagonalSE: 11,
    diagonalSW: 12,
} as const;

// Map a gid onto a frame name in the 'packed' atlas. `start` tiles are only
// spawn markers, so they render as plain floor (the crab is drawn on top).
const TILE_FRAMES: Record<number, string> = {
    [GID.door]: 'door',
    [GID.exit]: 'exit',
    [GID.floor]: 'floor',
    [GID.wall]: 'wall',
    [GID.key]: 'key',
    [GID.start]: 'floor',
    [GID.diagonalNE]: 'diagonal-ne',
    [GID.diagonalNW]: 'diagonal-nw',
    [GID.diagonalSE]: 'diagonal-se',
    [GID.diagonalSW]: 'diagonal-sw',
};

// Crab hop animation: how long after the last button press the crab arrives,
// and the easing that makes it shoot off and settle softly. Logical position
// updates instantly; only the sprite glides, so input stays responsive.
const MOVE_MS = 128;
const MOVE_EASE = 'Cubic.easeOut';
// While an arrow key is held, the crab keeps moving one tile every this long.
const MOVE_REPEAT_MS = 128;

// Wrap an angle (radians) into [-PI, PI], for picking the short way round.
const wrapAngle = (a: number): number => {
    const t = a % (Math.PI * 2);
    if (t > Math.PI) return t - Math.PI * 2;
    if (t < -Math.PI) return t + Math.PI * 2;
    return t;
};

// Each crab state has a simple 2-frame loop (xxx_0 / xxx_1); a frame is shown
// for this long before swapping. Sleeping crabs animate at a slower pace.
const ANIM_FRAME_MS = 256;
const SLEEP_ANIM_FRAME_MS = 512;
const CRAB_STATES = [
    'crab',
    'crab_sleep',
    'crab_with_key',
    'crab_with_key_sleep',
] as const;

// Levels are imported statically so the bundler picks them up and inlines them.
// To add a level: import it above, add a case here, and add its name to
// LEVEL_ORDER below (which also defines the order levels are played in).
const fetchLevel = (name: string): TiledMap => {
    switch (name) {
        case '1':
            return level1 as unknown as TiledMap;
        case '2':
            return level2 as unknown as TiledMap;
        case '3':
            return level3 as unknown as TiledMap;
        case '4':
            return level4 as unknown as TiledMap;
        default:
            throw new Error(`Unknown level: ${name}`);
    }
};

const LEVEL_ORDER = ['1', '2', '3', '4'];

// Decode Tiled's base64 layer data into a flat array of gids (one uint32 each,
// little-endian, row-major).
const decodeLayer = (layer: TiledLayer): number[] => {
    const binary = atob(layer.data);
    const gids: number[] = [];
    for (let i = 0; i + 3 < binary.length; i += 4) {
        gids.push(
            (binary.charCodeAt(i) |
                (binary.charCodeAt(i + 1) << 8) |
                (binary.charCodeAt(i + 2) << 16) |
                (binary.charCodeAt(i + 3) << 24)) >>>
                0,
        );
    }
    return gids;
};

export type KeyMap = {
    Up: Phaser.Input.Keyboard.Key;
    Left: Phaser.Input.Keyboard.Key;
    Right: Phaser.Input.Keyboard.Key;
    Down: Phaser.Input.Keyboard.Key;
    R: Phaser.Input.Keyboard.Key;
    Space: Phaser.Input.Keyboard.Key;
};

export class GameScene extends Scene {
    keymap?: KeyMap;
    gameOverActive: boolean;

    skybg?: GameObjects.Image;

    gameTicks = 0;
    score = 0;

    bgm?: Phaser.Sound.BaseSound;

    currentLevel = '1';

    // Level grid + geometry, filled in by setupLevel.
    private grid: number[] = [];
    private gridWidth = 0;
    private gridHeight = 0;
    private tileWidth = 64;
    private tileHeight = 64;
    private originX = 0;
    private originY = 0;

    private tiles?: GameObjects.Container;
    // Rendered tile sprite per grid index, so we can change a tile at runtime
    // (e.g. an opened door or a picked-up key turning into floor).
    private tileSprites: (GameObjects.Image | undefined)[] = [];
    private crabs: Crab[] = [];
    private activeCrab = 0;
    private levelWon = false;
    // Counts down between auto-repeated moves while an arrow key is held.
    private moveCooldown = 0;

    constructor(config: Phaser.Types.Scenes.SettingsConfig) {
        if (!config) {
            config = {};
        }
        config.key = 'GameScene';
        super(config);
        this.gameOverActive = false;
    }

    create() {
        this.score = 0;
        this.sound.pauseOnBlur = false;

        // Stop any BGM that might be running already, this is mostly due to this scene being active to show a preview of the game
        // while the menu is running.
        if (this.bgm) {
            this.bgm.stop();
            this.bgm.destroy();
            this.bgm = undefined;
        }

        // If we have BGM we can use this to start the right track, depending on whether the menu is active or not.
        /*
        if (options.playBGM) {
            if (
                this.scene.isActive('MainMenuScene') &&
                this.cache.audio.has('menubgm')
            ) {
                this.bgm = this.sound.add('menubgm', { loop: true });
            }
            if (!this.bgm && this.cache.audio.has('bgm')) {
                this.bgm = this.sound.add('bgm', { loop: true });
            }
            this.bgm?.play();
        }
        */
        const ui = this.scene.get('UIScene') as UIScene;
        ui.events.emit('reset');

        this.physics.world.setBounds(0, 0, 1280, 720);
        this.keymap = this.input.keyboard?.addKeys(
            'Up,Left,Right,Down,R,Space',
        ) as KeyMap;
        this.gameOverActive = false;
        this.gameTicks = 0;

        this.skybg = this.add.image(-64, -64, 'packed', 'wall');
        this.skybg
            .setDisplaySize(1280 + 128, 720 + 128)
            .setOrigin(0, 0)
            .setDepth(-100);

        this.cameras.main.setBounds(0, 0, 1280, 720);

        this.createCrabAnims();

        // A fresh start (initial boot or "Start over") always begins at the
        // first level. R reloads the current level, completeLevel advances.
        this.loadLevel(LEVEL_ORDER[0]);
    }

    // Register the looping 2-frame animation for each crab state. Animations
    // live in the global manager, so we only create them once.
    private createCrabAnims() {
        for (const state of CRAB_STATES) {
            if (this.anims.exists(state)) {
                continue;
            }
            const frameMs = state.endsWith('_sleep')
                ? SLEEP_ANIM_FRAME_MS
                : ANIM_FRAME_MS;
            this.anims.create({
                key: state,
                frames: [
                    { key: 'packed', frame: `${state}_0` },
                    { key: 'packed', frame: `${state}_1` },
                ],
                frameRate: 1000 / frameMs,
                repeat: -1,
            });
        }
    }

    // Load a level by name and (re)build it. Safe to call again at any time,
    // e.g. when the player restarts a level by pressing R.
    loadLevel(name: string) {
        this.currentLevel = name;
        this.setupLevel(fetchLevel(name));
    }

    // Decode a map, draw its tiles and spawn its crabs. Any previously built
    // level is discarded first.
    private setupLevel(map: TiledMap) {
        this.tiles?.destroy(true);
        for (const crab of this.crabs) {
            this.stopCrabTween(crab);
            crab.sprite.destroy();
        }
        this.crabs = [];
        this.activeCrab = 0;
        this.levelWon = false;

        // We only support a single tile layer for now.
        const layer = map.layers.find((l) => l.type === 'tilelayer');
        if (!layer) {
            throw new Error('Level has no tile layer');
        }

        this.grid = decodeLayer(layer);
        this.gridWidth = layer.width;
        this.gridHeight = layer.height;
        this.tileWidth = map.tilewidth;
        this.tileHeight = map.tileheight;
        this.originX = (this.scale.width - this.gridWidth * this.tileWidth) / 2;
        this.originY =
            (this.scale.height - this.gridHeight * this.tileHeight) / 2;

        this.tiles = this.add.container();
        this.tileSprites = new Array(this.grid.length).fill(undefined);
        for (let i = 0; i < this.grid.length; i++) {
            const frame = TILE_FRAMES[this.grid[i]];
            if (!frame) {
                continue;
            }
            const x = i % this.gridWidth;
            const y = Math.floor(i / this.gridWidth);
            const tile = this.add
                .image(this.pixelX(x), this.pixelY(y), 'packed', frame)
                .setOrigin(0, 0);
            this.tiles.add(tile);
            this.tileSprites[i] = tile;
        }

        this.spawnCrabs();
        this.refreshActiveCrab();
    }

    // Turn pairs of adjacent start tiles into crabs, anchored on the top-left
    // tile. A horizontally-adjacent pair makes a horizontal crab, a
    // vertically-adjacent pair a vertical one.
    private spawnCrabs() {
        const used = new Set<number>();
        for (let i = 0; i < this.grid.length; i++) {
            if (this.grid[i] !== GID.start || used.has(i)) {
                continue;
            }
            const x = i % this.gridWidth;
            const y = Math.floor(i / this.gridWidth);
            const right = i + 1;
            const down = i + this.gridWidth;

            let orientation: Orientation;
            if (
                x + 1 < this.gridWidth &&
                this.grid[right] === GID.start &&
                !used.has(right)
            ) {
                orientation = 'horizontal';
                used.add(i).add(right);
            } else if (
                y + 1 < this.gridHeight &&
                this.grid[down] === GID.start &&
                !used.has(down)
            ) {
                orientation = 'vertical';
                used.add(i).add(down);
            } else {
                console.warn(`Unpaired start tile at ${x},${y} ignored`);
                continue;
            }

            const sprite = this.add
                .sprite(0, 0, 'packed', 'crab_0')
                .setOrigin(0.5, 0.5);
            const crab: Crab = { x, y, orientation, hasKey: false, sprite };
            this.placeCrab(crab);
            this.crabs.push(crab);
        }
    }

    // The two grid cells a crab covers, given its anchor and orientation.
    private crabCells(
        x: number,
        y: number,
        o: Orientation,
    ): [number, number][] {
        return o === 'vertical'
            ? [
                  [x, y],
                  [x, y + 1],
              ]
            : [
                  [x, y],
                  [x + 1, y],
              ];
    }

    // Where a crab's sprite belongs for its current cells/orientation. Origin is
    // centered so the rotation pivots correctly.
    private crabTarget(crab: Crab): { x: number; y: number; rotation: number } {
        const horizontal = crab.orientation === 'horizontal';
        return {
            x:
                this.pixelX(crab.x) +
                (horizontal ? this.tileWidth : this.tileWidth / 2),
            y:
                this.pixelY(crab.y) +
                (horizontal ? this.tileHeight / 2 : this.tileHeight),
            rotation: horizontal ? 0 : Math.PI / 2,
        };
    }

    // Snap a crab's sprite to its cells immediately (used when spawning).
    private placeCrab(crab: Crab) {
        const t = this.crabTarget(crab);
        crab.sprite.setRotation(t.rotation).setPosition(t.x, t.y);
    }

    // Glide a crab's sprite to its cells with a quick, cartoony ease-out. Any
    // in-flight motion is replaced and re-aimed from the current position, so
    // rapid presses keep momentum and the crab settles MOVE_MS after the last
    // one. An optional callback runs when the glide finishes (e.g. to destroy a
    // crab once it has slid into the exit).
    private animateCrab(crab: Crab, onComplete?: () => void) {
        const t = this.crabTarget(crab);
        this.stopCrabTween(crab);
        crab.tween = this.tweens.add({
            targets: crab.sprite,
            x: t.x,
            y: t.y,
            rotation: t.rotation,
            duration: MOVE_MS,
            ease: MOVE_EASE,
            onComplete,
        });
    }

    // Glide a crab around a corner: its sprite sweeps a quarter-arc around the
    // diagonal cell (pivotX, pivotY) while rotating, so it visibly slides along
    // the diagonal instead of cutting straight across it.
    private animateCrabAroundCorner(
        crab: Crab,
        pivotX: number,
        pivotY: number,
        onComplete?: () => void,
    ) {
        const t = this.crabTarget(crab);
        const px = this.pixelX(pivotX) + this.tileWidth / 2;
        const py = this.pixelY(pivotY) + this.tileHeight / 2;
        const sx = crab.sprite.x;
        const sy = crab.sprite.y;
        const sr = crab.sprite.rotation;
        const startRadius = Math.hypot(sx - px, sy - py);
        const endRadius = Math.hypot(t.x - px, t.y - py);
        const startAngle = Math.atan2(sy - py, sx - px);
        const sweep = wrapAngle(Math.atan2(t.y - py, t.x - px) - startAngle);
        const spin = wrapAngle(t.rotation - sr);

        const progress = { v: 0 };
        this.stopCrabTween(crab);
        crab.tween = this.tweens.add({
            targets: progress,
            v: 1,
            duration: MOVE_MS,
            ease: MOVE_EASE,
            onUpdate: () => {
                const angle = startAngle + sweep * progress.v;
                const radius =
                    startRadius + (endRadius - startRadius) * progress.v;
                crab.sprite.setPosition(
                    px + Math.cos(angle) * radius,
                    py + Math.sin(angle) * radius,
                );
                crab.sprite.setRotation(sr + spin * progress.v);
            },
            onComplete,
        });
    }

    // Cancel a crab's in-flight motion (sprite tween or arc proxy tween).
    private stopCrabTween(crab: Crab) {
        crab.tween?.stop();
        crab.tween = undefined;
        this.tweens.killTweensOf(crab.sprite);
    }

    update(_time: number, delta: number) {
        this.gameTicks += delta;
        if (!this.keymap) {
            return;
        }
        if (this.moveCooldown > 0) {
            this.moveCooldown -= delta;
        }

        if (Input.Keyboard.JustDown(this.keymap.R)) {
            this.loadLevel(this.currentLevel);
            return;
        }
        if (this.levelWon || this.crabs.length === 0) {
            return;
        }

        // Space switches crab; a crab only moves along its own axis: left/right
        // for horizontal crabs, up/down for vertical ones. Holding a key keeps
        // it moving.
        if (Input.Keyboard.JustDown(this.keymap.Space)) {
            this.cycleCrab();
        } else if (this.crabs[this.activeCrab].orientation === 'horizontal') {
            if (!this.tryHeldMove(this.keymap.Left, -1, 0)) {
                this.tryHeldMove(this.keymap.Right, 1, 0);
            }
        } else {
            if (!this.tryHeldMove(this.keymap.Up, 0, -1)) {
                this.tryHeldMove(this.keymap.Down, 0, 1);
            }
        }
    }

    // Move once when a key is first pressed, then repeat while it stays held.
    // Returns whether this key produced a move this frame.
    private tryHeldMove(
        key: Phaser.Input.Keyboard.Key,
        dx: number,
        dy: number,
    ): boolean {
        const fresh = Input.Keyboard.JustDown(key);
        if (!fresh && !(key.isDown && this.moveCooldown <= 0)) {
            return false;
        }
        this.moveActiveCrab(dx, dy);
        this.moveCooldown = MOVE_REPEAT_MS;
        return true;
    }

    // Switch which crab the player controls, cycling through the list.
    private cycleCrab() {
        this.activeCrab = (this.activeCrab + 1) % this.crabs.length;
        this.refreshActiveCrab();
    }

    // Move the active crab one tile along its axis, if the target cells are
    // free. Running into a diagonal slides the crab around the corner; bumping
    // into a door with a key opens it (consuming the key) instead of moving;
    // bumping into another crab rotates that crab out of the way if it has room.
    // Sliding onto a key picks it up. A crab that ends up on an exit tile is
    // considered home and removed; the level is won once the last crab leaves.
    private moveActiveCrab(dx: number, dy: number) {
        const crab = this.crabs[this.activeCrab];
        const nx = crab.x + dx;
        const ny = crab.y + dy;
        // The leading tile is the only cell the crab newly enters when it shifts
        // by one; it is where a diagonal, door, wall or crab would act.
        const dir = dx + dy;
        const [leadX, leadY] =
            crab.orientation === 'vertical'
                ? [nx, dir > 0 ? ny + 1 : ny]
                : [dir > 0 ? nx + 1 : nx, ny];

        // A diagonal redirects the crab around the corner rather than letting it
        // step onto the diagonal tile.
        if (this.isDiagonal(leadX, leadY)) {
            if (this.slideAroundDiagonal(crab, leadX, leadY, dx, dy)) {
                this.finishActiveMove(crab, (oc) =>
                    this.animateCrabAroundCorner(crab, leadX, leadY, oc),
                );
            }
            return;
        }

        if (!this.canOccupy(nx, ny, crab)) {
            if (crab.hasKey && this.isDoor(leadX, leadY)) {
                this.setTile(leadX, leadY, GID.floor);
                this.setCrabKey(crab, false);
                return;
            }
            // If a crab is in the way, try to rotate it aside and move in behind
            // it; otherwise the move is blocked.
            const blocking = this.crabAt(leadX, leadY, crab);
            if (
                !blocking ||
                !this.rotateOutOfWay(blocking, leadX, leadY, dx, dy)
            ) {
                return;
            }
        }
        crab.x = nx;
        crab.y = ny;
        this.finishActiveMove(crab, (oc) => this.animateCrab(crab, oc));
    }

    // After the active crab's cells/orientation have been updated, pick up any
    // key it now covers, play its motion via `animate`, and remove it if it
    // reached the exit (winning the level once the last crab is home).
    private finishActiveMove(
        crab: Crab,
        animate: (onComplete?: () => void) => void,
    ) {
        const cells = this.crabCells(crab.x, crab.y, crab.orientation);
        for (const [cx, cy] of cells) {
            if (this.isKey(cx, cy)) {
                this.setTile(cx, cy, GID.floor);
                this.setCrabKey(crab, true);
            }
        }

        if (cells.some(([cx, cy]) => this.isExit(cx, cy))) {
            // Let the crab finish its move onto the exit, then remove its sprite.
            const sprite = crab.sprite;
            animate(() => sprite.destroy());
            this.crabs.splice(this.activeCrab, 1);
            if (this.crabs.length === 0) {
                this.completeLevel();
                return;
            }
            this.activeCrab %= this.crabs.length;
        } else {
            animate();
        }
        this.refreshActiveCrab();
    }

    // The two orthogonal directions a diagonal tile opens onto (its floor side),
    // or undefined if the gid is not a diagonal.
    private diagonalArms(
        gid: number,
    ): [[number, number], [number, number]] | undefined {
        switch (gid) {
            case GID.diagonalNW:
                return [
                    [0, 1],
                    [1, 0],
                ]; // south + east
            case GID.diagonalNE:
                return [
                    [0, 1],
                    [-1, 0],
                ]; // south + west
            case GID.diagonalSW:
                return [
                    [0, -1],
                    [1, 0],
                ]; // north + east
            case GID.diagonalSE:
                return [
                    [0, -1],
                    [-1, 0],
                ]; // north + west
            default:
                return undefined;
        }
    }

    // Slide `crab` around the diagonal at (dxc, dyc) that it is moving (dx, dy)
    // into: it pivots from the arm it arrived along onto the diagonal's other
    // arm, ending perpendicular. Returns true and updates the crab's cells if
    // the destination is free; otherwise the move is blocked.
    private slideAroundDiagonal(
        crab: Crab,
        dxc: number,
        dyc: number,
        dx: number,
        dy: number,
    ): boolean {
        const arms = this.diagonalArms(this.tileAt(dxc, dyc));
        if (!arms) {
            return false;
        }
        // The crab arrives from the arm opposite its travel direction; it must
        // be one of the diagonal's open arms.
        const entry: [number, number] = [-dx, -dy];
        const exit = arms.find(
            ([ax, ay]) => ax !== entry[0] || ay !== entry[1],
        );
        const fromArm = arms.some(
            ([ax, ay]) => ax === entry[0] && ay === entry[1],
        );
        if (!fromArm || !exit) {
            return false;
        }
        const [ex, ey] = exit;
        const c1: [number, number] = [dxc + ex, dyc + ey];
        const c2: [number, number] = [dxc + 2 * ex, dyc + 2 * ey];
        if (!this.cellFree(...c1, crab) || !this.cellFree(...c2, crab)) {
            return false;
        }
        // Update cells only; the caller animates the arc around the corner.
        this.assignCrabCells(crab, ...c1, ...c2);
        return true;
    }

    // Can a crab stand at anchor (x, y)? Every cell it would cover must be
    // inside the level, free of obstacles (walls, doors, diagonals), and not
    // taken by another crab.
    private canOccupy(x: number, y: number, self: Crab): boolean {
        for (const [cx, cy] of this.crabCells(x, y, self.orientation)) {
            if (this.isObstacle(cx, cy)) {
                return false;
            }
            for (const other of this.crabs) {
                if (other === self) {
                    continue;
                }
                const taken = this.crabCells(
                    other.x,
                    other.y,
                    other.orientation,
                ).some(([ox, oy]) => ox === cx && oy === cy);
                if (taken) {
                    return false;
                }
            }
        }
        return true;
    }

    // The crab (other than `exclude`) covering cell (x, y), if any.
    private crabAt(x: number, y: number, exclude: Crab): Crab | undefined {
        return this.crabs.find(
            (c) =>
                c !== exclude &&
                this.crabCells(c.x, c.y, c.orientation).some(
                    ([cx, cy]) => cx === x && cy === y,
                ),
        );
    }

    // A cell a crab may rotate or slide into: inside the level, not an obstacle,
    // and not held by another crab.
    private cellFree(x: number, y: number, exclude: Crab): boolean {
        return !this.isObstacle(x, y) && !this.crabAt(x, y, exclude);
    }

    // Rotate `crab` so its tile at (cx, cy) swings out of the way, pivoting
    // around its other tile. The pushed tile moves one step diagonally; we
    // prefer the swing that follows the pusher's (dx, dy). Returns true and
    // applies the rotation if a free diagonal cell exists.
    private rotateOutOfWay(
        crab: Crab,
        cx: number,
        cy: number,
        dx: number,
        dy: number,
    ): boolean {
        const pivot = this.crabCells(crab.x, crab.y, crab.orientation).find(
            ([px, py]) => px !== cx || py !== cy,
        );
        if (!pivot) {
            return false;
        }
        const [px, py] = pivot;
        const vx = cx - px;
        const vy = cy - py;
        // The two 90° turns of the pivot->tile vector.
        const turns: [number, number][] = [
            [-vy, vx],
            [vy, -vx],
        ];
        let best: [number, number] | undefined;
        let bestScore = -Infinity;
        for (const [ux, uy] of turns) {
            const tx = px + ux;
            const ty = py + uy;
            if (!this.cellFree(tx, ty, crab)) {
                continue;
            }
            // How much the tile's diagonal step follows the push direction.
            const score = (ux - vx) * dx + (uy - vy) * dy;
            if (score > bestScore) {
                bestScore = score;
                best = [tx, ty];
            }
        }
        if (!best) {
            return false;
        }
        this.setCrabCells(crab, px, py, best[0], best[1]);
        return true;
    }

    // Set a crab's logical cells from two orthogonally-adjacent cells, deriving
    // its anchor (top-left) and orientation. Does not touch the sprite.
    private assignCrabCells(
        crab: Crab,
        ax: number,
        ay: number,
        bx: number,
        by: number,
    ) {
        crab.x = Math.min(ax, bx);
        crab.y = Math.min(ay, by);
        crab.orientation = ay === by ? 'horizontal' : 'vertical';
    }

    // As assignCrabCells, but also glides the sprite to the new cells.
    private setCrabCells(
        crab: Crab,
        ax: number,
        ay: number,
        bx: number,
        by: number,
    ) {
        this.assignCrabCells(crab, ax, ay, bx, by);
        this.animateCrab(crab);
    }

    // Give or take a crab's key, updating its sprite to match.
    private setCrabKey(crab: Crab, hasKey: boolean) {
        crab.hasKey = hasKey;
        this.applyCrabSprite(crab);
    }

    // Play a crab's looping animation for whether it carries a key and whether
    // it is the one the player currently controls (inactive crabs are asleep).
    private applyCrabSprite(crab: Crab) {
        const active = this.crabs[this.activeCrab] === crab;
        const variant = crab.hasKey ? 'crab_with_key' : 'crab';
        crab.sprite.play(active ? variant : `${variant}_sleep`, true);
    }

    // Replace the tile at (x, y) in both the grid and the rendered map.
    private setTile(x: number, y: number, gid: number) {
        const idx = y * this.gridWidth + x;
        this.grid[idx] = gid;
        const frame = TILE_FRAMES[gid];
        if (frame) {
            this.tileSprites[idx]?.setFrame(frame);
        }
    }

    private refreshActiveCrab() {
        for (const crab of this.crabs) {
            this.applyCrabSprite(crab);
        }
    }

    // Advance to the next level in LEVEL_ORDER, or show the win screen once the
    // last level is cleared.
    private completeLevel() {
        const next = LEVEL_ORDER[LEVEL_ORDER.indexOf(this.currentLevel) + 1];
        if (next) {
            this.loadLevel(next);
        } else {
            this.levelWon = true;
            this.scene.launch('GameWonScene');
        }
    }

    private tileAt(x: number, y: number): number {
        if (x < 0 || y < 0 || x >= this.gridWidth || y >= this.gridHeight) {
            return GID.wall;
        }
        return this.grid[y * this.gridWidth + x];
    }

    // Solid tiles block crab movement: walls and (closed) doors.
    private isSolid(x: number, y: number): boolean {
        const gid = this.tileAt(x, y);
        return gid === GID.wall || gid === GID.door;
    }

    private isDiagonal(x: number, y: number): boolean {
        const gid = this.tileAt(x, y);
        return (
            gid === GID.diagonalNE ||
            gid === GID.diagonalNW ||
            gid === GID.diagonalSE ||
            gid === GID.diagonalSW
        );
    }

    // A cell a crab cannot rest on: solid tiles, plus diagonals (which redirect
    // a crab around their corner rather than letting it stop on them).
    private isObstacle(x: number, y: number): boolean {
        return this.isSolid(x, y) || this.isDiagonal(x, y);
    }

    private isDoor(x: number, y: number): boolean {
        return this.tileAt(x, y) === GID.door;
    }

    private isKey(x: number, y: number): boolean {
        return this.tileAt(x, y) === GID.key;
    }

    private isExit(x: number, y: number): boolean {
        return this.tileAt(x, y) === GID.exit;
    }

    private pixelX(tileX: number): number {
        return this.originX + tileX * this.tileWidth;
    }

    private pixelY(tileY: number): number {
        return this.originY + tileY * this.tileHeight;
    }
}
