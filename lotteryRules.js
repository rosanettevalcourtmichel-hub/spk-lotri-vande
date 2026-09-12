export const DRAWS = ["Jòjwa", "Florida", "Nouyòk"];

export const GAME_TYPES = [
  { id: "boul", label: "Boul" },
  { id: "lotto_3", label: "Loto 3 chif" },
  { id: "lotto_4", label: "Loto 4 chif" },
  { id: "lotto_5", label: "Loto 5 chif" },
  { id: "maryaj", label: "Maryaj" },
];

export const OPTIONS = {
  Boul: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
  "Loto 3 chif": ["123", "456", "789"],
  "Loto 4 chif": ["1234", "5678", "9012"],
  "Loto 5 chif": ["12345", "45612", "67890"],
  Maryaj: ["1212", "4567", "8901"],
};

export const limits = {
  general: {},
  agents: {},
  draws: {},
};

const normalizeDigits = (value) => String(value ?? "").replace(/\D/g, "");

const normalizeResult = (result = {}) => ({
  firstLot3: normalizeDigits(result.firstLot3),
  firstLot2: normalizeDigits(result.firstLot2),
  secondLot2: normalizeDigits(result.secondLot2),
  thirdLot2: normalizeDigits(result.thirdLot2),
  thirdLot3: normalizeDigits(result.thirdLot3),
});

export const validateOption = (game, value) => {
  const digits = normalizeDigits(value);

  if (!digits) return false;

  if (game === "Boul") return digits.length >= 1 && digits.length <= 2;
  if (game === "Loto 3 chif") return digits.length === 3;
  if (game === "Loto 4 chif") return digits.length === 4;
  if (game === "Loto 5 chif") return digits.length === 5;
  if (game === "Maryaj") return digits.length === 4;

  return false;
};

const getMultiplier = (game, optionId) => {
  if (game === "Boul") {
    if (optionId === 1 || optionId === "firstLot2") return 50;
    if (optionId === 2 || optionId === "secondLot2") return 20;
    if (optionId === 3 || optionId === "thirdLot2") return 10;
    return 0;
  }

  if (game === "Loto 3 chif") return 500;
  if (game === "Loto 4 chif") return 1000;
  if (game === "Loto 5 chif") return 5000;
  if (game === "Maryaj") return 1000;

  return 0;
};

export const calculateTicketPayout = (ticket = {}, result = {}) => {
  const price = Number(ticket.price || 0);
  const game = ticket.type || ticket.game || "";
  const option = normalizeDigits(ticket.option);
  const selectedOption = Number(ticket.optionId || 1);
  const draw = normalizeResult(result);

  const fallback = {
    ticketId: ticket.id || ticket.ticketId || null,
    game,
    option,
    isWinner: false,
    payout: 0,
    multiplier: 0,
    rule: null,
    matchedValue: null,
    detail: "Pa gen match",
  };

  if (!game || !option || !price) return fallback;

  if (game === "Boul") {
    const matches = [
      { value: draw.firstLot2, multiplier: 50, rule: "1er Lo" },
      { value: draw.secondLot2, multiplier: 20, rule: "2e Lo" },
      { value: draw.thirdLot2, multiplier: 10, rule: "3e Lo" },
    ];

    const match = matches.find((item) => item.value && item.value === option);

    if (!match) return fallback;

    return {
      ...fallback,
      isWinner: true,
      payout: price * match.multiplier,
      multiplier: match.multiplier,
      rule: match.rule,
      matchedValue: option,
      detail: `Match ${match.rule}`,
    };
  }

  if (game === "Loto 3 chif") {
    if (option !== draw.firstLot3) return fallback;

    return {
      ...fallback,
      isWinner: true,
      payout: price * 500,
      multiplier: 500,
      rule: "Loto 3",
      matchedValue: option,
      detail: "Match ak 3 chif premye lo a",
    };
  }

  if (game === "Loto 4 chif") {
    const combos = {
      1: `${draw.firstLot2}${draw.secondLot2}`,
      2: `${draw.firstLot2}${draw.thirdLot2}`,
      3: `${draw.secondLot2}${draw.thirdLot2}`,
    };

    const expected = combos[selectedOption] || combos[1];
    if (option !== expected) return fallback;

    return {
      ...fallback,
      isWinner: true,
      payout: price * 1000,
      multiplier: 1000,
      rule: `Opsyon ${selectedOption}`,
      matchedValue: expected,
      detail: "Match Loto 4 chif",
    };
  }

  if (game === "Loto 5 chif") {
    const option3Source = draw.thirdLot3 || draw.thirdLot2 || draw.firstLot3;
    const op1 = option.startsWith(draw.firstLot3) && option.slice(3) === draw.secondLot2;
    const op2 = option.startsWith(draw.firstLot3) && option.slice(3) === draw.thirdLot2;
    const op3 = option.startsWith(draw.secondLot2) && option.slice(2) === option3Source;

    const winningOption =
      selectedOption === 1
        ? op1
        : selectedOption === 2
          ? op2
          : selectedOption === 3
            ? op3
            : false;

    if (!winningOption) return fallback;

    return {
      ...fallback,
      isWinner: true,
      payout: price * 5000,
      multiplier: 5000,
      rule: `Opsyon ${selectedOption}`,
      matchedValue: option,
      detail: `Match Loto 5 chif (Opsyon ${selectedOption})`,
    };
  }

  if (game === "Maryaj") {
    const combos = {
      1: `${draw.firstLot2}${draw.secondLot2}`,
      2: `${draw.firstLot2}${draw.thirdLot2}`,
      3: `${draw.secondLot2}${draw.thirdLot2}`,
    };

    const expected = combos[selectedOption] || combos[1];

    if (option !== expected) return fallback;

    return {
      ...fallback,
      isWinner: true,
      payout: price * 1000,
      multiplier: 1000,
      rule: `Maryaj Opsyon ${selectedOption}`,
      matchedValue: expected,
      detail: "Match maryaj",
    };
  }

  return fallback;
};

export const buildWinningReport = (tickets = [], result = {}) => {
  const draw = normalizeResult(result);
  const payouts = [];

  let salesTotal = 0;
  let payoutsTotal = 0;
  let winnersTotal = 0;

  tickets.forEach((ticket) => {
    const ticketPrice = Number(ticket.price || 0);
    salesTotal += ticketPrice;

    const win = calculateTicketPayout(ticket, draw);

    if (win.isWinner) {
      payouts.push({
        ...ticket,
        ...win,
      });
      payoutsTotal += win.payout;
      winnersTotal += 1;
    }
  });

  return {
    totalSales: salesTotal,
    totalPayouts: payoutsTotal,
    net: salesTotal - payoutsTotal,
    winners: payouts,
    winnerCount: winnersTotal,
  };
};

const toMinutes = (timeString = "00:00") => {
  const clean = String(timeString).trim();
  if (!clean) return 0;

  const match = clean.match(/^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/i);
  if (!match) return 0;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const suffix = match[3]?.toLowerCase();

  if (suffix === "pm" && hours < 12) hours += 12;
  if (suffix === "am" && hours === 12) hours = 0;

  return hours * 60 + minutes;
};

const DRAW_WINDOWS = {
  "Jòjwa": [
    { drawTime: "12:29", cutoff: "12:25" },
    { drawTime: "18:59", cutoff: "18:54" },
  ],
  Florida: [
    { drawTime: "13:30", cutoff: "13:25" },
    { drawTime: "21:45", cutoff: "21:40" },
  ],
  "Nouyòk": [
    { drawTime: "14:30", cutoff: "14:25" },
    { drawTime: "22:30", cutoff: "22:25" },
  ],
};

export const getOpenDraws = () => {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  return Object.entries(DRAW_WINDOWS)
    .filter(([_, windows]) => {
      const hasOpenWindow = windows.some((window) => currentMinutes < toMinutes(window.cutoff));
      return hasOpenWindow;
    })
    .map(([name]) => name);
};

export const isDrawOpen = (draw) => {
  const windows = DRAW_WINDOWS[draw];
  if (!windows || !windows.length) return false;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  return windows.some((window) => currentMinutes < toMinutes(window.cutoff));
};

export const getDrawCutoffMessage = (draw) => {
  const windows = DRAW_WINDOWS[draw] || [];
  const lastCutoff = windows
    .map((window) => window.cutoff)
    .sort((a, b) => toMinutes(b) - toMinutes(a))[0];

  return `Tiraj ${draw} fèmen pou vandè. Dènye lè pou pran fich se ${lastCutoff}.`;
};
