import {defineConfig} from 'vite';
import {storyStatus} from './dev/story-status.js';

export default defineConfig({
  base:'./',
  plugins:[storyStatus()],
  build:{rolldownOptions:{input:['index.html','welcome.html','storyboard.html','world.html','study-000.html','character-lab.html','studio.html']}}
});
