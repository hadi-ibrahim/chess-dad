/**
 * Beginner lessons.
 *
 * Plain-language chess basics, each with one small puzzle. The teaching text is
 * deliberately short: one idea per paragraph, no jargon that isn't explained in
 * the same breath.
 *
 * Every puzzle here was verified against chess.js — the solution is legal, the
 * SAN matches, and the tactic actually works (a fork really forks, the smothered
 * mate really mates, the skewer really wins the queen). If you add a lesson,
 * verify its position the same way before shipping it; a lesson with a wrong
 * answer is worse than no lesson.
 */

export type LessonGroup = "Basics" | "The engine" | "Why we study" | "Tactics";

export interface MovePuzzle {
  kind: "move";
  fen: string;
  /** UCI, exactly as chess.js reports `move.lan` (e.g. "e1g1", "b7b8q"). */
  solutionUci: string;
  solutionSan: string;
  prompt: string;
  hint: string;
  /** Shown once the move is found, or when the answer is revealed. */
  explain: string;
}

export interface QuizPuzzle {
  kind: "quiz";
  question: string;
  options: string[];
  /** Index into `options`. */
  answer: number;
  explain: string;
  /** Optional board shown alongside the question. */
  fen?: string;
}

export type LessonPuzzle = MovePuzzle | QuizPuzzle;

export interface Lesson {
  id: string;
  group: LessonGroup;
  title: string;
  /** One-line hook for the list. */
  summary: string;
  body: string[];
  /** Optional term/definition pairs — rendered as a reference list. */
  terms?: { term: string; def: string }[];
  puzzle: LessonPuzzle;
}

export const LESSON_GROUPS: LessonGroup[] = ["Basics", "The engine", "Why we study", "Tactics"];

export const LESSONS: Lesson[] = [
  // ---------------------------------------------------------------- Basics
  {
    id: "reading-a-move",
    group: "Basics",
    title: "Reading a move",
    summary: "e4, Nf3, O-O — what the letters actually mean.",
    body: [
      "Every chess move has a short name. Once you can read them you can follow any game, book, or engine line.",
      "Pieces are letters: K king, Q queen, R rook, B bishop, N knight. Pawns get no letter at all — a move with no letter is always a pawn move.",
      "A move is written as the piece and the square it lands on. Nf3 means a knight moves to f3. e4 means a pawn moves to e4.",
      "The board is a grid. Files are letters a to h, counting from White's left. Ranks are numbers 1 to 8, counting from White's side. Every square has exactly one name, and it never changes.",
      "Captures get an x: Bxe5 means a bishop takes something on e5. Castling is written O-O or O-O-O instead of a square, because two pieces move at once.",
      "Two symbols you will see constantly: + means check, and # means checkmate. So Re8+ is a rook moving to e8 and giving check.",
      "If two identical pieces could both reach the same square, you say where the piece came from: Rae1 means the rook from the a-file. Pawn promotions add an equals sign: e8=Q.",
    ],
    terms: [
      { term: "K Q R B N", def: "King, Queen, Rook, Bishop, Knight" },
      { term: "no letter", def: "A pawn move — e4, d5, exd6" },
      { term: "x", def: "A capture — Bxe5" },
      { term: "+", def: "Check" },
      { term: "#", def: "Checkmate" },
      { term: "O-O / O-O-O", def: "Castling, kingside / queenside" },
      { term: "=Q", def: "A pawn promoting to a queen" },
    ],
    puzzle: {
      kind: "quiz",
      fen: "6k1/5p1p/8/8/8/8/8/4R2K w - - 0 1",
      question: "White's rook slides across to e8 and gives check. How is that move written?",
      options: ["Re8+", "Re8", "RxE8", "e8R+"],
      answer: 0,
      explain:
        "Re8+ — R for the rook, e8 for the square it lands on, and + because it is check. There is no capture here, so no x.",
    },
  },
  {
    id: "annotations",
    group: "Basics",
    title: "The annotation symbols",
    summary: "! and ? — how chess writers grade a move.",
    body: [
      "You will see punctuation after moves in books, in articles, and on the game review screen. It is a writer's opinion, not part of the rules — but it is a quick way to spot the turning points.",
      "Question marks mean the move was bad. A single ? is a dubious move; ?? is a blunder, and it usually means a piece or the game has just been given away.",
      "Exclamation marks mean the move was good. ! is a strong move; !! is brilliant — hard to find, and it changes the assessment of the position.",
      "The mixed marks are the most useful. !? means interesting but risky. ?! means risky and probably not best. Chess is full of moves like that.",
      "There is a habit hiding in these symbols. Before you judge your own move, ask what your opponent's last move deserved. A ?? from them is usually your chance.",
      "Chess Dad grades moves the same way on the review screen, but with the engine doing the judging: every move is compared to the best one, and sorted from brilliant down to blunder.",
    ],
    terms: [
      { term: "!!", def: "Brilliant — hard to find, and it changes the game" },
      { term: "!", def: "A strong move" },
      { term: "!?", def: "Interesting, but risky" },
      { term: "?!", def: "Risky, and probably not best" },
      { term: "?", def: "A mistake" },
      { term: "??", def: "A blunder — it usually loses material or the game" },
    ],
    puzzle: {
      kind: "move",
      fen: "6k1/5ppp/8/8/8/8/8/4R2K w - - 0 1",
      solutionUci: "e1e8",
      solutionSan: "Re8#",
      prompt: "Black's king is boxed in by its own pawns. Play the move that ends the game — the one that earns #.",
      hint: "Your rook belongs on the back rank. Once it lands there, Black's own pawns block every escape square.",
      explain:
        "Re8#. The rook owns the whole eighth rank, and the king's own pawns on f7, g7 and h7 take away every square it could run to. That is checkmate, written with a #.",
    },
  },
  {
    id: "castling",
    group: "Basics",
    title: "Castling",
    summary: "The one move where two pieces move at once.",
    body: [
      "Castling is the only move where your king and a rook move together. The king slides two squares toward the rook, and the rook hops over to the square the king crossed.",
      "Kingside castling is written O-O: the king goes from e1 to g1 and the rook from h1 to f1. Queenside is O-O-O: the king goes to c1 and the rook to d1.",
      "It is the fastest way to make your king safe. A castled king sits behind three pawns. An uncastled king stands in the middle, where every open file points straight at it.",
      "You lose the right to castle on a side if your king moves, or if that rook moves. Move the rook out and back again and castling on that side is gone for good — there is no way to earn it back.",
      "You also cannot castle out of check, through check, or into check. The king's whole path, including the square it crosses, has to be safe. The rook may be attacked; the king may not.",
      "Queenside castling puts the king one square from the edge, which is slightly riskier and slower to organise. Kingside first, unless you have a reason.",
    ],
    terms: [
      { term: "O-O", def: "Kingside: king to g1, rook to f1" },
      { term: "O-O-O", def: "Queenside: king to c1, rook to d1" },
      { term: "Requirements", def: "King and that rook untouched, path safe, not currently in check" },
    ],
    puzzle: {
      kind: "move",
      fen: "5k2/ppp5/2n5/8/2B5/8/PPP3PP/4K2R w K - 0 1",
      solutionUci: "e1g1",
      solutionSan: "O-O+",
      prompt: "Your king is stuck in the middle and your rook is doing nothing. Play the move that fixes both at once.",
      hint: "Two pieces move in one turn — and remember to move the king, not the rook.",
      explain:
        "O-O — and it arrives with check, because the rook lands on the open f-file and stares straight at the black king. Castling is usually a quiet move; here it is also a threat.",
    },
  },
  {
    id: "en-passant",
    group: "Basics",
    title: "En passant",
    summary: "The capture that only exists for one move.",
    body: [
      "En passant is French for \"in passing\". It is a special pawn capture, and it is the move that surprises everybody once.",
      "It only ever happens when a pawn tries to sneak past your pawn by moving two squares in one go.",
      "The rule: if your pawn has reached its fifth rank, and an enemy pawn jumps two squares to land right beside it, you may capture it as though it had only moved one square. You take the pawn, and your pawn finishes on the empty square it passed over.",
      "You must play it immediately. If you play anything else, the chance is gone for the rest of the game. That is what makes it feel like a trick.",
      "Only pawns can do it, and only against a pawn. Some people write exd6 e.p. to make it clear what happened.",
      "It is rare, but it decides games. Knowing it exists means you will never lose a pawn to it by accident — and you will spot the one time it wins you one.",
    ],
    terms: [
      { term: "exd6", def: "Written like any other pawn capture" },
      { term: "e.p.", def: "Sometimes added to say \"en passant\"" },
      { term: "Window", def: "You have exactly one move to take it" },
    ],
    puzzle: {
      kind: "move",
      fen: "rnbqkb1r/ppp1pppp/5n2/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3",
      solutionUci: "e5d6",
      solutionSan: "exd6",
      prompt: "Black just pushed that pawn two squares to d5, hoping to slip past yours. Take it.",
      hint: "Your pawn on e5 does not capture forward — pawns capture diagonally, onto the square the black pawn skipped over.",
      explain:
        "exd6. Your pawn captures on the square the black pawn passed over, and the pawn on d5 comes off the board. En passant is only on offer right now: play any other move and the chance is gone forever.",
    },
  },
  {
    id: "promotion",
    group: "Basics",
    title: "Promotion",
    summary: "What happens when a pawn reaches the far side.",
    body: [
      "A pawn that reaches the last rank must become something else. That is promotion, and it happens as part of the move — not on a later turn.",
      "You may choose a queen, rook, bishop or knight. You cannot stay a pawn, and you cannot become a king.",
      "Almost always you take the queen, because it is the strongest piece and a second queen usually ends the game on the spot.",
      "But \"almost always\" is not \"always\". The one to remember is knight promotion: a new knight can give a fork or a check that a queen cannot, because a queen cannot jump over anything. Those are the puzzles where the answer is =N.",
      "You can promote even if the piece was captured earlier. Chess sets come with spares; the board simply has two queens for a while.",
      "It is written e8=Q, or exd8=N if the pawn captured on its way. Just like any other move, plus = and the piece you chose.",
    ],
    terms: [
      { term: "e8=Q", def: "The pawn promotes to a queen" },
      { term: "=N", def: "Promote to a knight — the promotion that wins when a queen cannot" },
      { term: "Rule", def: "You must promote, and you choose which piece" },
    ],
    puzzle: {
      kind: "move",
      fen: "7k/1P6/8/8/8/8/8/6K1 w - - 0 1",
      solutionUci: "b7b8q",
      solutionSan: "b8=Q+",
      prompt: "Your pawn is one square from promotion. Take the best piece.",
      hint: "The square in front of your pawn is empty — and there is a king waiting on the eighth rank.",
      explain:
        "b8=Q+ — a new queen and a check in the same move. The pawn leaves the board and the queen arrives. This is why a passed pawn is so frightening in the endgame: it is a threat that gets stronger every move.",
    },
  },

  // ------------------------------------------------------------ The engine
  {
    id: "stockfish",
    group: "The engine",
    title: "What is Stockfish?",
    summary: "The engine that never misses — and why we trust it.",
    body: [
      "Stockfish is a chess engine: a program that calculates positions extremely fast, millions of positions a second, and plays far better than any human. It runs inside Chess Dad.",
      "Chess Dad treats it as ground truth. It does not have opinions and it does not guess. For any position it reports the best move it can find and how good the position is.",
      "The engine has no fear and no style. It will happily give up its queen if that is strongest, and it will take a free pawn every single time. That is exactly what makes it useful: when the engine says a move is bad, the move is bad.",
      "Chess Dad pairs the engine with plain-language coaching. The engine supplies the truth and the words explain it, so the explanation can never contradict the board.",
      "One honest limitation: the engine is far stronger than any explanation of it. It will sometimes suggest a move it cannot fully justify in words. When that happens, trust the move and treat the explanation as a hint rather than a proof.",
      "In practice you do not need to agree with it. You need to ask why. The engine's best move is really a question: what did this see that I did not?",
    ],
    terms: [
      { term: "Engine", def: "A program that calculates chess — not a player with a plan" },
      { term: "Best move", def: "The move the engine believes is strongest here" },
      { term: "Evaluation", def: "The engine's verdict on the position, as a number" },
    ],
    puzzle: {
      kind: "quiz",
      question:
        "Stockfish suggests a move that appears to give away a rook for nothing. What is the most reasonable conclusion?",
      options: [
        "It has seen a line you have not — look for the follow-up",
        "The engine is broken",
        "It is choosing randomly to surprise you",
        "It values rooks less than pawns",
      ],
      answer: 0,
      explain:
        "Engines do not bluff and do not get bored. When their move looks wrong there is almost always something behind it: a mate, a fork, or a forced recovery of the material. Ask what happens after your opponent's best reply.",
    },
  },
  {
    id: "centipawns",
    group: "The engine",
    title: "What is a centipawn?",
    summary: "Why the engine says +0.3 instead of \"slightly better\".",
    body: [
      "The engine measures positions in centipawns, or cp. One pawn is worth 100 cp, so a centipawn is one hundredth of a pawn.",
      "That gives a common scale. +0.00 is dead level. +1.00 means White is about a pawn up. −2.50 means White is behind by two and a half pawns.",
      "The usual piece values are pawn 1, knight 3, bishop 3, rook 5, queen 9. That is why trading a rook for a bishop is about −2, and why the engine gets so upset about it.",
      "The sign is always from White's point of view. A plus means White is better, a minus means Black is better — no matter whose turn it is.",
      "Small numbers matter less than they look. Anything inside roughly ±0.5 is equal: the engine is saying it would slightly prefer one side, not that the game is decided.",
      "Big numbers are the ones to respect. Past ±2 somebody has won material for real, and past ±5 the game is effectively over between ordinary players.",
      "You will see cp used two ways. As an evaluation, it describes the position. As a loss, it describes a move — \"that cost 250 cp\" means a quarter of a pawn. The second is how Chess Dad picks which moves are worth talking about.",
    ],
    terms: [
      { term: "1 pawn = 100 cp", def: "The unit" },
      { term: "+ / −", def: "Always from White's point of view" },
      { term: "±0.5", def: "Roughly equal — still a game" },
      { term: "Values", def: "P 1, N 3, B 3, R 5, Q 9" },
    ],
    puzzle: {
      kind: "quiz",
      fen: "7k/8/8/8/8/8/8/R5K1 w - - 0 1",
      question: "White has an extra rook and nothing else is going on. Roughly what evaluation would the engine give?",
      options: ["About +5", "About +0.5", "About −5", "About +50"],
      answer: 0,
      explain:
        "A rook is worth about five pawns, so +5. Note that +50 would be wrong: that would mean White is fifty pawns ahead. The scale runs in hundredths of a pawn, so whole numbers on the evaluation are whole pawns.",
    },
  },

  // ---------------------------------------------------------- Why we study
  {
    id: "openings",
    group: "Why we study",
    title: "Why openings matter",
    summary: "The first ten moves — and why memorising them is not the point.",
    body: [
      "The opening is the first phase of the game, roughly the first ten to fifteen moves. Its job is simple: get your pieces out and your king safe.",
      "Three principles are worth more than any amount of memorisation. Control the centre — the four squares e4, d4, e5, d5. Develop your knights and bishops toward the middle. And castle early.",
      "Why the centre? A piece in the middle controls more squares and can reach either wing quickly. A knight on the rim really is dim.",
      "Do not bring your queen out early. She is your most valuable piece, and an early queen becomes a target: every time the opponent attacks her you have to move her again, and they develop a piece for free.",
      "Do not move the same piece twice in the opening without a reason. Every move should bring a new piece into the game.",
      "This is why openings are worth studying — not to memorise twenty moves, but to recognise the positions you keep reaching and to understand the ideas behind them.",
      "And it is why the engine's warnings about an early queen sortie are worth heeding. Watch how quickly a careless opening turns into a lost position.",
    ],
    terms: [
      { term: "Centre", def: "e4, d4, e5, d5 — the squares worth fighting for" },
      { term: "Development", def: "Getting your knights and bishops off the back rank" },
      { term: "Tempo", def: "One move. Losing a tempo means wasting one." },
      { term: "Book", def: "The opening moves that theory agrees on" },
    ],
    puzzle: {
      kind: "move",
      fen: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
      solutionUci: "h5f7",
      solutionSan: "Qxf7#",
      prompt:
        "Black spent the opening moving pawns and knights and never made their king safe. Punish it — mate in one.",
      hint: "The f7 square is defended only by the king, and your bishop on c4 is covering it.",
      explain:
        "Qxf7#. This is the oldest trap in chess, and it works because Black never castled. Your queen is protected by the bishop, so the king cannot take her — and every escape square is covered. An uncastled king is a target, and the opening is when you learn to keep it safe.",
    },
  },
  {
    id: "endgames",
    group: "Why we study",
    title: "Why endgames matter",
    summary: "The phase most players skip, and the one that wins the most games.",
    body: [
      "The endgame is what is left when most pieces are gone: kings, a few pawns, perhaps a rook or a bishop. It is the phase beginners study least and gain the most from.",
      "Openings are about memory; endgames are about understanding. There is less on the board, so you can genuinely calculate — and the same few positions come up again and again.",
      "The single most valuable thing to learn is how to mate with a king and queen. It is mechanical, it is easy once you know the method, and it converts almost every winning endgame you will ever reach.",
      "The method: use your queen to shrink the enemy king's box one step at a time, and walk your own king up to help. You need the king. A lone queen cannot mate.",
      "Then learn king and pawn endings. A single pawn can be worth the whole game, and whether it promotes usually comes down to one idea: who gets their king in front of it first.",
      "In practice: if you are winning material, trade pieces rather than pawns. Fewer pieces means fewer chances for a swindle, and a queen against a bare king is a win you cannot throw away.",
      "If you only study one thing this month, study the basic mates. It is the difference between winning a won game and letting it drift into a draw.",
    ],
    terms: [
      { term: "Basic mates", def: "K+Q vs K and K+R vs K — learn these until they are automatic" },
      { term: "Passed pawn", def: "A pawn with no enemy pawn left to stop it" },
      { term: "Promotion race", def: "Whose pawn promotes first — and whether the king can catch it" },
      { term: "Opposition", def: "The king standoff that decides most pawn endings" },
    ],
    puzzle: {
      kind: "move",
      fen: "7k/8/6K1/8/8/8/Q7/8 w - - 0 1",
      solutionUci: "a2a8",
      solutionSan: "Qa8#",
      prompt: "You have a queen and your king is already close. Finish it — mate in one.",
      hint: "Your king covers the escape squares beside the corner. Slide the queen to the far edge of the board.",
      explain:
        "Qa8#. Your king on g6 seals h7 and g7, and the queen takes the whole eighth rank. That is the basic mate: the queen builds the box, the king closes the door. Practise it until you can do it without thinking.",
    },
  },

  // ---------------------------------------------------------------- Tactics
  {
    id: "fork",
    group: "Tactics",
    title: "The fork",
    summary: "One piece, two targets, and they can only save one.",
    body: [
      "A fork is when one piece attacks two or more enemy pieces at the same time. Your opponent can only move one of them, so you win the other.",
      "Knights are the fork champions, because their move is strange enough that people miss it. A knight can attack two pieces that have nothing to do with each other.",
      "Pawns fork too, and theirs is often the most irritating kind. A pawn attacking two pieces is worth more than either piece on its own.",
      "The deadliest fork is a check. If your knight checks the king and attacks the queen at the same time, your opponent has to deal with the check first — and then you take the queen. For free.",
      "So when you are hunting for tactics, look for enemy pieces arranged in knight-shapes. A king and a queen one knight-move apart is a fork waiting to happen.",
      "Watch your own pieces the same way. Keep them defended, and do not leave two of them sitting where a single enemy knight can reach both.",
    ],
    terms: [
      { term: "Fork", def: "One piece attacks two or more enemy pieces" },
      { term: "Royal fork", def: "A fork that includes the king, so it cannot be ignored" },
      { term: "Family fork", def: "A knight forking king and queen — the classic" },
    ],
    puzzle: {
      kind: "move",
      fen: "4k3/3q4/8/8/6N1/8/8/6K1 w - - 0 1",
      solutionUci: "g4f6",
      solutionSan: "Nf6+",
      prompt: "Your knight can reach a square that attacks the king and the queen at once. Find it.",
      hint: "Land the knight so that it checks the king. From there, the queen is on the same knight-shape.",
      explain:
        "Nf6+ forks the king on e8 and the queen on d7. Black must answer the check first, so the king moves — and Nxd7 takes the queen. That is a royal fork: because the check cannot be ignored, the second target is free.",
    },
  },
  {
    id: "pin-and-skewer",
    group: "Tactics",
    title: "The pin and the skewer",
    summary: "Two ways to make a piece stand still, or take what is behind it.",
    body: [
      "A pin freezes a piece. It happens when an enemy piece sits on the same line as one of your bishops, rooks or queens, with something more valuable behind it — usually the king.",
      "When the king is behind, the pin is absolute: the pinned piece legally cannot move, because moving would expose the king to check. A pinned knight might as well be a statue.",
      "That is why an early bishop pinning a knight to the king is so strong. The knight cannot run, so you can attack it with a pawn and simply win it.",
      "A skewer is the same idea pointing the other way. You attack the valuable piece first, and take the lesser one behind it when it is forced to move.",
      "The classic skewer is a check. You check the king along a line, the king must step aside, and whatever was standing behind it is now yours.",
      "Both ideas depend on lines, so bishops, rooks and queens do this work — knights and pawns cannot. When you see two enemy pieces on the same line, look for a way to put one of your line pieces onto it.",
    ],
    terms: [
      { term: "Pin", def: "A piece cannot move because something valuable is behind it" },
      { term: "Absolute pin", def: "The king is behind it, so moving is illegal" },
      { term: "Skewer", def: "Attack the valuable piece first, then take what is behind it" },
      { term: "Line piece", def: "A bishop, rook or queen — the pieces that pin and skewer" },
    ],
    puzzle: {
      kind: "move",
      fen: "7q/8/8/8/3k4/8/8/2B3K1 w - - 0 1",
      solutionUci: "c1b2",
      solutionSan: "Bb2+",
      prompt:
        "The black king and queen are standing on the same long diagonal. Get your bishop onto that line and win the queen.",
      hint: "Find the diagonal that runs through both the king and the queen, and put your bishop on it so it gives check.",
      explain:
        "Bb2+ places the bishop on the a1–h8 diagonal. The king must step off the line, and then Bxh8 takes the queen — and crucially, the king cannot get back to defend her from any of its escape squares. The king was attacked first; the queen paid for it. That is a skewer.",
    },
  },
  {
    id: "discovered-attack",
    group: "Tactics",
    title: "The discovered attack",
    summary: "Move one piece, and the piece behind it starts working.",
    body: [
      "A discovered attack is a move where you step one piece out of the way and reveal an attack from the piece behind it. Both pieces are suddenly attacking.",
      "It is powerful because your opponent can usually only answer one threat. If the revealed attack is a check, they must answer the check — and the piece you moved is free to do whatever it wanted.",
      "That combination is a discovered check, and it is the strongest kind. Your opponent is forced to respond to the check, so the piece that moved can capture, fork, or threaten something else with no reply.",
      "The shape to look for: two of your pieces lined up on the same line as their king, with one of yours standing in front. Moving that front piece out of the way — especially if it captures something — is the whole idea.",
      "Watch for it happening to you. Before you move, glance at the line you are leaving. A knight sitting in front of your own bishop is a discovered check waiting for your opponent to find.",
      "One caution: the piece you move must do something useful. A discovered check that wins nothing simply wastes the surprise.",
    ],
    terms: [
      { term: "Discovered attack", def: "Moving a piece reveals an attack from the piece behind it" },
      { term: "Discovered check", def: "The revealed attack is a check — usually winning" },
      { term: "Battery", def: "Two line pieces stacked on the same line, ready to fire" },
    ],
    puzzle: {
      kind: "move",
      fen: "3k4/8/4b3/8/3N4/8/8/3R2K1 w - - 0 1",
      solutionUci: "d4e6",
      solutionSan: "Nxe6+",
      prompt:
        "Your knight is standing in front of your own rook. Move it forward with a capture — and see what it uncovers.",
      hint: "Take the bishop on e6. The square your knight leaves is on the same file as the black king.",
      explain:
        "Nxe6+ wins a bishop and gives discovered check in the same move: with the knight gone, your rook on d1 sees all the way down the d-file to the king. Black has to answer the check, so your knight is safe. One move, two problems.",
    },
  },
  {
    id: "attraction",
    group: "Tactics",
    title: "Attraction",
    summary: "Give away something valuable to drag a piece where you want it.",
    body: [
      "Attraction — sometimes called a decoy, or deflection — means sacrificing to force an enemy piece onto a square where it becomes a target, or off a square it was defending.",
      "The sacrifice is the point, not a mistake. You are paying material to move their piece somewhere it cannot survive.",
      "The most beautiful version is the smothered mate. You give up your queen to drag the rook onto a square, and then your knight delivers mate — with the king buried under its own pieces.",
      "You will meet the same idea in simpler forms constantly: a queen sacrifice that pulls a defender away from the square you need, or a rook sacrifice that drags the king into a fork.",
      "The trigger to look for is a king with no escape squares. If every square around their king is blocked by their own pieces, look for a sacrifice that forces one of those pieces to fill the last gap.",
      "It is completely fine to spot a sacrifice and decide not to play it. The skill is seeing that the possibility exists — you can always calculate and back out, but you cannot find a move you never considered.",
    ],
    terms: [
      { term: "Attraction", def: "A sacrifice that drags an enemy piece where you want it" },
      { term: "Deflection", def: "A sacrifice that pulls a defender off what it was guarding" },
      { term: "Smothered mate", def: "Mate by a knight against a king trapped by its own pieces" },
    ],
    puzzle: {
      kind: "move",
      fen: "5r1k/6pp/7N/8/8/1Q6/8/7K w - - 0 1",
      solutionUci: "b3g8",
      solutionSan: "Qg8+",
      prompt:
        "Every square around the black king is blocked by Black's own pieces. Sacrifice your queen to force the last one into place.",
      hint: "Put your queen right next to the king, where your knight is defending her. Only the rook can take it — and that rook is exactly where you want it.",
      explain:
        "Qg8+! Your knight on h6 defends g8, so the king cannot take. The rook is forced to capture on g8 — and now the king is completely smothered by its own pieces. Nf7# follows: a knight check the king cannot escape and the rook cannot capture. A queen is a fair price for mate.",
    },
  },
];

/** Lessons in `LESSONS`, grouped in the declared order. */
export function lessonsByGroup(): { group: LessonGroup; lessons: Lesson[] }[] {
  return LESSON_GROUPS.map((group) => ({
    group,
    lessons: LESSONS.filter((l) => l.group === group),
  })).filter((g) => g.lessons.length > 0);
}
