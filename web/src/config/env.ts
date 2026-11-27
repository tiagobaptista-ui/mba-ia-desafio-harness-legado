// Único lugar do front que lê import.meta.env (gate G5).
// `npm run up` grava VITE_API_URL em web/.env.local com a porta da API desta cópia.
export const API_URL: string = import.meta.env.VITE_API_URL || 'http://localhost:4000'
