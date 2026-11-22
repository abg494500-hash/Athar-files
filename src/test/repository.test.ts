import { runRepositoryContract } from './repository.contract'
import { createMockRepository } from './mock'

runRepositoryContract('المصدر الوهمي', (initial) => createMockRepository(initial))
