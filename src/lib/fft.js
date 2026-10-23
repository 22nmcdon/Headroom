// A fast Fourier transform, and nothing else.
//
// Two things in this app need one and neither of them owns it: the EQ's
// analyser averages a buffer into bands with it, and the saturator uses it to
// read the harmonic series a sine comes out of a nonlinearity as.

/** In-place iterative radix-2 FFT. `re` and `im` are a power of two long. */
export function fft(re, im) {
  const n = re.length;

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);

    for (let i = 0; i < n; i += length) {
      let curRe = 1;
      let curIm = 0;

      for (let j = 0; j < length / 2; j += 1) {
        const aRe = re[i + j];
        const aIm = im[i + j];
        const bRe = re[i + j + length / 2] * curRe - im[i + j + length / 2] * curIm;
        const bIm = re[i + j + length / 2] * curIm + im[i + j + length / 2] * curRe;

        re[i + j] = aRe + bRe;
        im[i + j] = aIm + bIm;
        re[i + j + length / 2] = aRe - bRe;
        im[i + j + length / 2] = aIm - bIm;

        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}
