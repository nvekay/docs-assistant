/** pgvector accepts vectors as text like "[0.1,0.2,...]" */
export const toVectorLiteral = (v: number[]) => `[${v.join(',')}]`;
