import { mount } from 'svelte';
import '@fontsource-variable/inter';
import '@fontsource-variable/noto-sans-sc';
import '@fontsource-variable/jetbrains-mono';
import App from './App.svelte';
import './styles/global.css';

const target = document.getElementById('app');
if (!target) throw new Error('Missing #app mount target');

const instance = mount(App, { target });

export default instance;
