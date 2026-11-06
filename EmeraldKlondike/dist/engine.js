(function (root, factory) {
  'use strict';
  var engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  if (root) root.KlondikeEngine = engine;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function cardColor(card) {
    return card.suit === 1 || card.suit === 3 ? 'red' : 'black';
  }
  function makeCard(suit, rank, faceUp) {
    return { id: suit + '-' + rank, suit: suit, rank: rank, faceUp: !!faceUp };
  }
  function randomSeed() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) {
      var words = new Uint32Array(4);
      globalThis.crypto.getRandomValues(words);
      return Array.from(words, function (word) { return word.toString(16).padStart(8, '0'); }).join('');
    }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }
  function seededRandom(seed) {
    var hash = 2166136261;
    for (var i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
    return function () {
      hash = (hash + 0x6D2B79F5) | 0;
      var value = hash;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }
  function createGame(options) {
    options = options || {};
    var seed = options.seed === undefined ? randomSeed() : String(options.seed);
    var difficulty = ['easy', 'classic', 'hard'].indexOf(options.difficulty) >= 0
      ? options.difficulty : options.drawCount === 3 ? 'classic' : 'easy';
    var drawCount = options.drawCount === 1 || options.drawCount === 3
      ? options.drawCount : difficulty === 'easy' ? 1 : 3;
    var random = seededRandom(seed);
    var deck = [];
    for (var suit = 0; suit < 4; suit++) {
      for (var rank = 1; rank <= 13; rank++) deck.push(makeCard(suit, rank, false));
    }
    for (var i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1));
      var swap = deck[i]; deck[i] = deck[j]; deck[j] = swap;
    }
    var tableau = Array.from({ length: 7 }, function () { return []; });
    for (var column = 0; column < 7; column++) {
      for (var row = 0; row <= column; row++) {
        var card = deck.pop();
        card.faceUp = row === column;
        tableau[column].push(card);
      }
    }
    return {
      version: 1, seed: seed, difficulty: difficulty, drawCount: drawCount, stock: deck, waste: [],
      foundations: [[], [], [], []], tableau: tableau,
      score: 0, moves: 0, redeals: 0, status: 'playing'
    };
  }
  function follows(upper, lower) {
    return upper.rank === lower.rank + 1 && cardColor(upper) !== cardColor(lower);
  }
  function validSequence(cards, start) {
    for (var i = start; i < cards.length; i++) {
      if (!cards[i].faceUp || i > start && !follows(cards[i - 1], cards[i])) return false;
    }
    return true;
  }
  function validateState(state) {
    if (!state || typeof state !== 'object' || state.version !== 1 || typeof state.seed !== 'string'
        || state.drawCount !== 1 && state.drawCount !== 3
        || state.difficulty !== undefined && ['easy', 'classic', 'hard'].indexOf(state.difficulty) < 0
        || !Number.isSafeInteger(state.score) || state.score < 0
        || !Number.isSafeInteger(state.moves) || state.moves < 0
        || !Number.isSafeInteger(state.redeals) || state.redeals < 0
        || state.status !== 'playing' && state.status !== 'won'
        || !Array.isArray(state.stock) || !Array.isArray(state.waste)
        || !Array.isArray(state.foundations) || state.foundations.length !== 4
        || !Array.isArray(state.tableau) || state.tableau.length !== 7) return false;
    var seen = new Set();
    var count = 0;
    var zones = [state.stock, state.waste].concat(state.foundations, state.tableau);
    for (var z = 0; z < zones.length; z++) {
      if (!Array.isArray(zones[z])) return false;
      for (var i = 0; i < zones[z].length; i++) {
        var card = zones[z][i];
        if (!card || typeof card !== 'object' || !Number.isInteger(card.suit) || card.suit < 0 || card.suit > 3
            || !Number.isInteger(card.rank) || card.rank < 1 || card.rank > 13
            || card.id !== card.suit + '-' + card.rank || typeof card.faceUp !== 'boolean'
            || seen.has(card.id)) return false;
        seen.add(card.id); count++;
      }
    }
    if (count !== 52 || state.stock.some(function (card) { return card.faceUp; })
        || state.waste.some(function (card) { return !card.faceUp; })) return false;
    for (var f = 0; f < 4; f++) {
      if (state.foundations[f].some(function (card, index) {
        return !card.faceUp || card.suit !== f || card.rank !== index + 1;
      })) return false;
    }
    for (var t = 0; t < 7; t++) {
      var pile = state.tableau[t];
      if (pile.length && !pile[pile.length - 1].faceUp) return false;
      var firstUp = pile.findIndex(function (card) { return card.faceUp; });
      if (firstUp >= 0 && !validSequence(pile, firstUp)) return false;
    }
    var won = state.foundations.every(function (pile) { return pile.length === 13; });
    return state.status === (won ? 'won' : 'playing');
  }
  function cloneState(state) {
    function clonePile(pile) { return pile.map(function (card) { return Object.assign({}, card); }); }
    return {
      version: state.version, seed: state.seed,
      difficulty: state.difficulty || (state.drawCount === 1 ? 'easy' : 'classic'), drawCount: state.drawCount,
      stock: clonePile(state.stock), waste: clonePile(state.waste),
      foundations: state.foundations.map(clonePile), tableau: state.tableau.map(clonePile),
      score: state.score, moves: state.moves, redeals: state.redeals, status: state.status
    };
  }
  function getSource(state, from) {
    if (!from || !Number.isInteger(from.index)) return null;
    var pile;
    if (from.pile === 'tableau' && from.index >= 0 && from.index < 7) pile = state.tableau[from.index];
    else if (from.pile === 'foundation' && from.index >= 0 && from.index < 4) pile = state.foundations[from.index];
    else if (from.pile === 'waste' && from.index === 0) pile = state.waste;
    else return null;
    var cardIndex = from.cardIndex === undefined ? pile.length - 1 : from.cardIndex;
    if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= pile.length
        || from.pile !== 'tableau' && cardIndex !== pile.length - 1
        || !validSequence(pile, cardIndex)) return null;
    return { pile: pile, cardIndex: cardIndex, card: pile[cardIndex] };
  }
  function legalTransfer(state, move) {
    if (!move || move.type !== 'move' || !move.to || !Number.isInteger(move.to.index)) return null;
    var source = getSource(state, move.from);
    if (!source) return null;
    var to = move.to;
    if (to.pile === 'foundation') {
      if (to.index < 0 || to.index > 3 || move.from.pile === 'foundation'
          || source.cardIndex !== source.pile.length - 1 || source.card.suit !== to.index
          || source.card.rank !== state.foundations[to.index].length + 1) return null;
    } else if (to.pile === 'tableau') {
      if (to.index < 0 || to.index > 6 || move.from.pile === 'tableau' && move.from.index === to.index) return null;
      var target = state.tableau[to.index];
      if (target.length ? !follows(target[target.length - 1], source.card) : source.card.rank !== 13) return null;
    } else return null;
    return source;
  }
  function applyMove(state, move) {
    if (!validateState(state) || state.status !== 'playing' || !move) return null;
    if (move.type === 'draw') {
      if (!canDraw(state)) return null;
      var drawn = cloneState(state);
      if (drawn.stock.length) {
        for (var n = 0; n < drawn.drawCount && drawn.stock.length; n++) {
          var card = drawn.stock.pop(); card.faceUp = true; drawn.waste.push(card);
        }
      } else {
        drawn.stock = drawn.waste.reverse(); drawn.waste = [];
        drawn.stock.forEach(function (card) { card.faceUp = false; });
        drawn.redeals++; drawn.score = Math.max(0, drawn.score - 20);
      }
      drawn.moves++;
      return drawn;
    }
    var source = legalTransfer(state, move);
    if (!source) return null;
    var next = cloneState(state);
    var fromPile = move.from.pile === 'waste' ? next.waste
      : move.from.pile === 'tableau' ? next.tableau[move.from.index] : next.foundations[move.from.index];
    var toPile = move.to.pile === 'tableau' ? next.tableau[move.to.index] : next.foundations[move.to.index];
    toPile.push.apply(toPile, fromPile.splice(source.cardIndex));
    var points = move.to.pile === 'foundation' ? 10 : move.from.pile === 'waste' ? 5 : 0;
    if (move.from.pile === 'foundation') points -= 15;
    if (move.from.pile === 'tableau' && fromPile.length && !fromPile[fromPile.length - 1].faceUp) {
      fromPile[fromPile.length - 1].faceUp = true; points += 5;
    }
    next.score = Math.max(0, next.score + points); next.moves++;
    if (next.foundations.every(function (pile) { return pile.length === 13; })) next.status = 'won';
    return next;
  }
  function getLegalMoves(state) {
    if (!validateState(state) || state.status !== 'playing') return [];
    var moves = [];
    function addFrom(from) {
      for (var t = 0; t < 7; t++) {
        var move = { type: 'move', from: from, to: { pile: 'tableau', index: t } };
        if (legalTransfer(state, move)) moves.push(move);
      }
      var source = getSource(state, from);
      if (source) {
        var foundation = { type: 'move', from: from, to: { pile: 'foundation', index: source.card.suit } };
        if (legalTransfer(state, foundation)) moves.push(foundation);
      }
    }
    if (state.waste.length) addFrom({ pile: 'waste', index: 0 });
    for (var t = 0; t < 7; t++) {
      for (var i = 0; i < state.tableau[t].length; i++) {
        if (state.tableau[t][i].faceUp) addFrom({ pile: 'tableau', index: t, cardIndex: i });
      }
    }
    for (var f = 0; f < 4; f++) if (state.foundations[f].length) addFrom({ pile: 'foundation', index: f });
    if (canDraw(state)) moves.push({ type: 'draw' });
    return moves;
  }
  function exposesHidden(state, move) {
    if (move.type !== 'move' || move.from.pile !== 'tableau') return false;
    var source = getSource(state, move.from);
    return source.cardIndex > 0 && !source.pile[source.cardIndex - 1].faceUp;
  }
  function safeFoundation(state, move) {
    var card = getSource(state, move.from).card;
    if (card.rank <= 2) return true;
    for (var suit = 0; suit < 4; suit++) {
      if (suit === card.suit) continue;
      var requiredRank = cardColor({ suit: suit }) === cardColor(card) ? card.rank - 2 : card.rank - 1;
      if (state.foundations[suit].length < requiredRank) return false;
    }
    return true;
  }
  function canAutoFinish(state) {
    return validateState(state) && state.status === 'playing' && !state.stock.length && !state.waste.length
      && state.tableau.every(function (pile) { return pile.every(function (card) { return card.faceUp; }); });
  }
  function canDraw(state) {
    if (!state) return false;
    if (state.stock.length) return true;
    if (!state.waste.length) return false;
    return state.difficulty !== 'hard' || state.redeals < 1;
  }
  function getAutoMove(state) {
    var moves = getLegalMoves(state).filter(function (move) { return move.type === 'move' && move.to.pile === 'foundation'; });
    var finishing = canAutoFinish(state);
    return moves.find(function (move) { return finishing || safeFoundation(state, move); }) || null;
  }
  function getHint(state) {
    var moves = getLegalMoves(state);
    var best = null, bestValue = -Infinity;
    moves.forEach(function (move) {
      var value;
      if (move.type === 'draw') value = state.stock.length ? 20 : 15;
      else if (move.from.pile === 'foundation') {
        var after = applyMove(state, move);
        var useful = getLegalMoves(after).some(function (followup) {
          return followup.type === 'move' && followup.to.pile === 'tableau'
            && followup.to.index === move.to.index
            && (exposesHidden(after, followup) || followup.from.pile === 'waste');
        });
        if (!useful) return;
        value = 5;
      } else if (move.to.pile === 'foundation') {
        value = safeFoundation(state, move) ? 200 : 25;
        if (exposesHidden(state, move)) value += 150;
      } else if (exposesHidden(state, move)) value = 180;
      else if (move.from.pile === 'waste') value = 80;
      else {
        var source = getSource(state, move.from);
        // Moving an entire King-led column to another empty slot changes nothing.
        if (!state.tableau[move.to.index].length && source.cardIndex === 0) return;
        value = 10;
        if (source.cardIndex === 0 && state.tableau.some(function (pile) {
          return pile.some(function (card, index) { return index > 0 && card.faceUp && card.rank === 13; });
        })) value = 60;
      }
      if (value > bestValue) { bestValue = value; best = move; }
    });
    return best;
  }
  return {
    createGame: createGame, applyMove: applyMove, getLegalMoves: getLegalMoves, getHint: getHint,
    canAutoFinish: canAutoFinish, getAutoMove: getAutoMove, validateState: validateState, cardColor: cardColor, canDraw: canDraw
  };
}));
