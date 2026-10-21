import './style.css';
import { Game } from './Game';

const container = document.getElementById('game');
const ui = document.getElementById('ui');
if (!container || !ui) throw new Error('Missing #game or #ui root element');

new Game(container, ui).run();
