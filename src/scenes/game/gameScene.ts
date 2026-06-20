import { type GameObjects, Scene } from 'phaser';

import type { UIScene } from '../ui/uiScene';

const animation_frames = (frame: string, frames: number | number[]) => {
    const ret = [];
    if (Array.isArray(frames)) {
        for (let i = 0; i < frames.length; i++) {
            ret.push({ key: 'packed', frame: `${frame}_${frames[i]}` });
        }
    } else {
        for (let i = 0; i < frames; i++) {
            ret.push({ key: 'packed', frame: `${frame}_${i}` });
        }
    }
    return ret;
};

export type KeyMap = {
    Up: Phaser.Input.Keyboard.Key;
    Left: Phaser.Input.Keyboard.Key;
    Right: Phaser.Input.Keyboard.Key;
    Down: Phaser.Input.Keyboard.Key;
    Z: Phaser.Input.Keyboard.Key;
    X: Phaser.Input.Keyboard.Key;
    Y: Phaser.Input.Keyboard.Key;
    Shift: Phaser.Input.Keyboard.Key;
};

export class GameScene extends Scene {
    keymap?: KeyMap;
    gameOverActive: boolean;

    skybg?: GameObjects.Image;

    gameTicks = 0;
    score = 0;

    bgm?: Phaser.Sound.BaseSound;
    player?: GameObjects.Sprite;
    playerVelocity = 2;

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
            'Up,Left,Right,Down,X,Z,Shift,Y',
        ) as KeyMap;
        this.gameOverActive = false;
        this.gameTicks = 0;

        this.skybg = this.add.image(-64, -64, 'packed', 'sky');
        this.skybg
            .setDisplaySize(1280 + 128, 720 + 128)
            .setOrigin(0, 0)
            .setDepth(-100);

        this.cameras.main.setBounds(0, 0, 1280, 720);

        if (!this.anims.exists('player_animated')) {
            this.anims.create({
                key: 'player_animated',
                frames: animation_frames('player', [0, 1, 2, 1]),
                frameRate: 6,
                repeat: -1,
            });
        }
        this.player = this.add.sprite(
            this.renderer.width / 2,
            this.renderer.height / 2,
            'packed',
            'player_0',
        );
        this.player.play('player_animated');
        this.player.setOrigin(0.6, 0.5);
        //this.cameras.main.startFollow(this.player, false, 0.1, 0.1, 0, 0);
    }

    update(_time: number, delta: number) {
        this.gameTicks += delta;
        if (this.player) {
            this.player.x += this.playerVelocity;
            if (
                this.player.x >
                this.renderer.width + this.player.displayWidth
            ) {
                this.player.x = -this.player.displayWidth;
                this.player.y =
                    Math.random() *
                        (this.renderer.height - this.player.displayHeight) +
                    this.player.displayHeight / 2;
                this.playerVelocity = Math.floor(Math.random() * 3) + 2;
            }
        }
    }
}
