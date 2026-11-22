import type { PlateAppearance } from './matchDetails'
import type { BattingGame } from './recordHistory'

const battedBallResults = new Set<PlateAppearance['result']>([
  'single', 'double', 'triple', 'homeRun', 'groundOut', 'flyOut', 'lineOut', 'popOut',
  'doublePlay', 'triplePlay', 'reachedOnError', 'fieldersChoice', 'sacrificeBunt', 'sacrificeFly',
])

export function battedBallDistribution(games: readonly BattingGame[]) {
  let missingPositions = 0
  let unavailableGames = 0
  const gamesPerDate = new Map<string, number>()
  const hits = games.flatMap(game => {
    const gameNumber = (gamesPerDate.get(game.date) ?? 0) + 1
    gamesPerDate.set(game.date, gameNumber)
    if (!game.details || game.details.source.batting === 'summary') {
      unavailableGames++
      return []
    }
    return [...game.details.plateAppearances].sort((a, b) => a.order - b.order).flatMap(row => {
      if (row.status !== 'complete' || !row.result ||
        !(battedBallResults.has(row.result) || (row.result === 'otherOut' && row.battedBall))) return []
      if (!row.fieldPoint) {
        missingPositions++
        return []
      }
      return [{
        id: JSON.stringify([game.id, row.id]), order: row.order, point: row.fieldPoint,
        result: row.result, date: game.date, gameNumber, opponent: game.details?.opponent,
      }]
    })
  })
  return { hits, missingPositions, unavailableGames }
}
