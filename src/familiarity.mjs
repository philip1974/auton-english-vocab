export function familiarityFor(card, flag) {
  if (flag === 'ignored') return 'ignored';
  if (flag === 'mastered') return 'mastered';
  if (!card || card.state === 'New' || card.state === 0) return 'new';
  if (card.state === 'Learning' || card.state === 'Relearning' || card.state === 1 || card.state === 3) return 'learning';
  const stability = Number(card.stability ?? 0);
  return stability >= 21 ? 'mastered' : 'familiar';
}

export function isReviewable(card, flag) {
  return flag !== 'ignored' && flag !== 'mastered';
}
