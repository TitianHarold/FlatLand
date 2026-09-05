import {defineConfig} from 'vite';

export default defineConfig({
  base:'./',
  build:{rolldownOptions:{input:['index.html','world.html','study-000.html','character-lab.html','studio.html']}}
});
