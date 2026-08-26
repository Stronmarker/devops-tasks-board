import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Sans ce plugin, Vite compile le JSX avec la transformation "classique"
// (React.createElement) alors que le code n'importe pas React par defaut :
// le bundle plante avec "React is not defined" et la page reste blanche.
// Le plugin active le runtime JSX automatique + le Fast Refresh en dev.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});
