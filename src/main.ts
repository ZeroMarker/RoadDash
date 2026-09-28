import './styles.css';
import { Game } from './game/game';

const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
if (!canvas) throw new Error('canvas #scene not found');

const game = new Game(canvas);

// Handy for poking at the sim from the console.
declare global {
  interface Window {
    roaddash?: Game;
  }
}
window.roaddash = game;

type HotContext = { dispose: (cb: () => void) => void };
const hot = (import.meta as unknown as { hot?: HotContext }).hot;
hot?.dispose(() => game.dispose());
