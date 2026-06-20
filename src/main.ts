import './style.css';
import './game.css';

import { Game, Scale, type Types, WEBGL } from 'phaser';
import options from './options';
import { GameScene } from './scenes/game/gameScene';
import { GameOverScene } from './scenes/menu/gameOver';
import { GameWonScene } from './scenes/menu/gameWon';
import { LoadingScreenScene } from './scenes/menu/loadingScreen';
import { MainMenuScene } from './scenes/menu/mainMenu';
import { UIScene } from './scenes/ui/uiScene';

const main = () => {
    const config: Types.Core.GameConfig = {
        type: WEBGL,
        width: 1280,
        height: 720,
        //pixelArt: true,
        parent: document.getElementById('phaser-parent') as HTMLElement,
        title: 'Vite / Phaser / TypeScript starter template',
        backgroundColor: '#000',
        dom: {
            createContainer: true,
        },
        input: {
            gamepad: true,
        },
        scale: {
            mode: Scale.FIT,
            autoCenter: Scale.CENTER_BOTH,
        },
        physics: {
            default: 'arcade',
            arcade: {
                gravity: { y: 0, x: 0 },
                debug: options.showCollider,
            },
        },
        scene: [
            LoadingScreenScene,
            MainMenuScene,
            GameScene,
            UIScene,
            GameOverScene,
            GameWonScene,
        ],
    };
    new Game(config);
};
setTimeout(main, 0);
