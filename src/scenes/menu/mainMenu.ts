import { Scene } from 'phaser';
import options from '../../options';

const introHTML = `<h1>Vite / Phaser / TypeScript starter template</h1>
<br/>
<p>Something I've built for myself to jumpstart games developed for jams, feel free to use it howevery you want.</p>`;

const gitHubLink = 'https://github.com/Melchizedek6809/game-starter';
const phaserLink = 'https://phaser.io/';

export class MainMenuScene extends Scene {
    constructor(config: Phaser.Types.Scenes.SettingsConfig) {
        if (!config) {
            config = {};
        }
        config.key = 'MainMenuScene';
        super(config);
    }

    startGame() {
        this.scene.run('UIScene');
        this.scene.switch('GameScene');
    }

    addCreditsLinks() {
        const $links = document.createElement('div');
        $links.innerHTML = `<a href="${gitHubLink}" target="_blank" class="github-link" title="Source code available on GitHub"></a>`;
        $links.innerHTML += `<a href="${phaserLink}" target="_blank" class="phaser-link" title="Made with the Phaser framework"></a>`;
        this.add.dom(this.scale.width - 128, this.scale.height - 48, $links);
    }

    create() {
        if (options.skipMenu) {
            this.startGame();
        }
        this.addCreditsLinks();
        this.scene.run('GameScene');

        const buttons = '<br/><br/><button class="green-button">Start</button>';
        const $intro = document.createElement('div');
        $intro.classList.add('main-menu-text');
        $intro.innerHTML = introHTML + buttons;
        this.add.dom(this.scale.width / 2, 96, $intro).setOrigin(0.5, 0);
        const $button = $intro.querySelector(
            'button.green-button',
        ) as HTMLElement;
        if ($button) {
            $button.addEventListener('click', this.startGame.bind(this));
            $button.focus();
        }
    }

    update() {
        if (this.input.gamepad?.gamepads[0]) {
            const gamepad = this.input.gamepad?.gamepads[0];
            if (gamepad.A) {
                this.startGame();
            }
        }
    }
}
