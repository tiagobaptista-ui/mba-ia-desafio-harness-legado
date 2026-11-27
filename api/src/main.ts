import { env } from './config/env'
import { app } from './http/app'

app.listen(env.PORT, () => {
  console.log(`API rodando na porta ${env.PORT}`)
})
