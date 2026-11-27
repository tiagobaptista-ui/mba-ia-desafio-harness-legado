import { HealthRepository } from '../repositories/health-repository'

export class HealthService {
  constructor(private health: HealthRepository) {}

  async isDatabaseUp() {
    try {
      await this.health.pingDatabase()
      return true
    } catch (err) {
      console.log('health: banco fora', err)
      return false
    }
  }
}
