# tracker-frontend

React + Vite + TypeScript + Tailwind + shadcn/ui. See [`../README.md`](../README.md) and
[`../PLAN.md`](../PLAN.md).

```bash
npm install
cp .env.example .env
npm run dev        # http://localhost:5173
```

- `src/components/ui/*` — shadcn/ui primitives (`npx shadcn@latest add <name>`)
- `src/components/data-grid/*` — reusable server-side grid (sort / paginate / filter / column
  toggle / CSV export), state synced to the URL
- `src/lib/api.ts` — typed fetch client (`/api` is proxied to the backend in dev)
- `src/router.tsx` — route tree
