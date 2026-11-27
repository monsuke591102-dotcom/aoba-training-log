import { isHitPlateResult, isNonHitContactResult, type Pitch, type PlateAppearance } from './matchDetails'
import type { BattingGame } from './recordHistory'

function isCompletedBattedBall(row: PlateAppearance): row is PlateAppearance & { result: NonNullable<PlateAppearance['result']> } {
  if (row.status !== 'complete' || !row.result) return false
  if (isHitPlateResult(row.result) || isNonHitContactResult(row.result)) return true
  if (row.result !== 'otherOut') return false
  if (row.battedBall) return true
  const finalPitch = row.pitches?.reduce<Pitch | undefined>((last, pitch) =>
    !last || pitch.order >= last.order ? pitch : last, undefined)
  // Legacy inPlay indicates contact in play without distinguishing hit from out.
  return finalPitch?.result === 'inPlay' || finalPitch?.result === 'inPlayNonHit'
}

export function gameBattedBallLocations(game: BattingGame, gameNumber = 1) {
  let missingPositions = 0
  const hits = [...(game.details?.plateAppearances ?? [])].sort((a, b) => a.order - b.order).flatMap(row => {
    if (!isCompletedBattedBall(row)) return []
    if (!row.fieldPoint) {
      missingPositions++
      return []
    }
    return [{
      id: JSON.stringify([game.id, row.id]), order: row.order, point: row.fieldPoint,
      result: row.result, date: game.date, gameNumber, opponent: game.details?.opponent,
    }]
  })
  return { hits, missingPositions }
}

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
    const locations = gameBattedBallLocations(game, gameNumber)
    missingPositions += locations.missingPositions
    return locations.hits
  })
  return { hits, missingPositions, unavailableGames }
}
