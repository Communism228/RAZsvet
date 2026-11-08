export function solveLP(lp) {
    const m = lp.b.length, n = lp.primary.length;
    if (lp.A.length !== m || lp.secondary.length !== n ||
        lp.b.some(b => !Number.isFinite(b) || b < 0) ||
        lp.A.some(row => row.length !== n || row.some(x => !Number.isFinite(x))) ||
        [...lp.primary, ...lp.secondary].some(x => !Number.isFinite(x)))
        throw new Error("Invalid LP; zero must be a feasible solution.");
    const eps = 1e-8;
    const D = [];
    const B = Array.from({ length: m }, (_, i) => n + i);
    const N = Array.from({ length: n }, (_, i) => i);
    for (let i = 0; i < m; i++) {
        const row = new Float64Array(n + 1);
        row.set(lp.A[i]);
        row[n] = lp.b[i];
        D.push(row);
    }
    for (const objective of [lp.primary, lp.secondary]) {
        const row = new Float64Array(n + 1);
        objective.forEach((c, j) => { row[j] = -c; });
        D.push(row);
    }
    function pivot(r, s) {
        const inv = 1 / D[r][s], pivotRow = D[r];
        for (let i = 0; i < m + 2; i++) {
            if (i === r)
                continue;
            const row = D[i], factor = row[s] * inv;
            if (factor !== 0) {
                for (let j = 0; j <= n; j++) {
                    if (j !== s)
                        row[j] -= pivotRow[j] * factor;
                }
            }
            row[s] = -factor;
        }
        for (let j = 0; j <= n; j++)
            if (j !== s)
                pivotRow[j] *= inv;
        pivotRow[s] = inv;
        [B[r], N[s]] = [N[s], B[r]];
    }
    let pivots = 0;
    for (;;) {
        let s = -1;
        for (let j = 0; j < n; j++) {
            const improves = D[m][j] < -eps ||
                (Math.abs(D[m][j]) <= eps && D[m + 1][j] < -eps);
            if (improves && (s < 0 || N[j] < N[s]))
                s = j;
        }
        if (s < 0)
            break;
        let r = -1;
        for (let i = 0; i < m; i++) {
            if (D[i][s] <= eps)
                continue;
            const ratio = D[i][n] / D[i][s];
            if (r < 0 || ratio < D[r][n] / D[r][s] - eps ||
                (Math.abs(ratio - D[r][n] / D[r][s]) <= eps && B[i] < B[r]))
                r = i;
        }
        if (r < 0)
            throw new Error("LP is unbounded.");
        pivot(r, s);
        if (++pivots > 15000)
            throw new Error("LP pivot limit; simplify the network.");
    }
    const x = Array(n).fill(0);
    for (let i = 0; i < m; i++)
        if (B[i] < n)
            x[B[i]] = Math.max(0, D[i][n]);
    // Catch numerically invalid results instead of silently showing impossible power.
    const residual = Math.max(0, ...lp.A.map((row, i) => row.reduce((sum, a, j) => sum + a * x[j], 0) - lp.b[i]));
    if (!Number.isFinite(residual) || residual > 1e-4)
        throw new Error(`LP residual too large: ${residual}`);
    return { x, objective: lp.primary.reduce((s, c, j) => s + c * x[j], 0), pivots };
}
