/** Annotation glyphs, as a chess book sets them. */
export const NAG: Record<string, string> = {
	"1": "!",
	"2": "?",
	"3": "!!",
	"4": "??",
	"5": "!?",
	"6": "?!",
	"7": "\u25a1", // only move
	"8": "\u25a1",
	"9": "\u00d7", // worst move
	"10": "=",
	"11": "=",
	"12": "\u21bb", // equal chances, active position
	"13": "\u221e",
	"14": "\u2a72", // white slightly better
	"15": "\u2a71", // black slightly better
	"16": "\u00b1", // white better
	"17": "\u2213", // black better
	"18": "+\u2212", // white winning
	"19": "\u2212+", // black winning
	"20": "+\u2212", // white has a crushing advantage
	"21": "\u2212+", // black has a crushing advantage
	"22": "Zugzwang", // white is in zugzwang
	"23": "Zugzwang", // black is in zugzwang
	"24": "\u2191", // white has a slight space advantage
	"25": "\u2193", // black has a slight space advantage
	"26": "\u21e7", // white has a moderate space advantage
	"27": "\u21e9", // black has a moderate space advantage
	"140": "\u2206", // with the idea ...
	"141": "\u2207", // aimed against ...
	"142": "\u2713", // better move
	"143": "\u00d7", // worse move
	"144": "\u2248", // equivalent move
	"145": "RR", // editor's remark
	"146": "N", // novelty
};

/** Spoken names for the glyphs, used as tooltips. */
export const NAG_NAME: Record<string, string> = {
	"1": "Good move",
	"2": "Mistake",
	"3": "Brilliant move",
	"4": "Blunder",
	"5": "Interesting move",
	"6": "Dubious move",
	"7": "Only move",
	"8": "Only move",
	"9": "Worst move",
	"10": "Drawish position",
	"11": "Equal chances, quiet position",
	"12": "Equal chances, active position",
	"13": "Unclear position",
	"14": "White is slightly better",
	"15": "Black is slightly better",
	"16": "White is better",
	"17": "Black is better",
	"18": "White is winning",
	"19": "Black has a decisive advantage",
	"20": "White has a crushing advantage",
	"21": "Black has a crushing advantage",
	"22": "White is in zugzwang",
	"23": "Black is in zugzwang",
	"24": "White has a slight space advantage",
	"25": "Black has a slight space advantage",
	"26": "White has a moderate space advantage",
	"27": "Black has a moderate space advantage",
	"140": "With the idea ...",
	"141": "Aimed against ...",
	"142": "Better move",
	"143": "Worse move",
	"144": "Equivalent move",
	"145": "Editor's remark",
	"146": "Novelty",
};
