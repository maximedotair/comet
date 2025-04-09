/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/lambda'], // Spécifier où Jest doit chercher les tests (dans le répertoire lambda)
  testMatch: [
      '**/__tests__/**/*.+(ts|tsx|js)',
      '**/?(*.)+(spec|test).+(ts|tsx|js)'
  ],
  // Optionnel: configurations supplémentaires
  // setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'], // Pour des configurations globales avant les tests
  // moduleNameMapper: { // Pour mapper des alias de chemins si vous en utilisez
  //   '^@/(.*)$': '<rootDir>/src/$1'
  // },
}; 