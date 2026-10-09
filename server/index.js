import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const { server } = createApp();

server.listen(port, () => {
  console.log(`BilimUp is running on http://localhost:${port}`);
  if (!process.env.OWNER_EMAIL) console.warn('Tip: set OWNER_EMAIL and OWNER_PASSWORD to create the owner account.');
});
