/** Which side is to move in a FEN. */
export function sideToMove(fen: string): "white" | "black" {
	return fen.split(/\s+/)[1] === "b" ? "black" : "white";
}
