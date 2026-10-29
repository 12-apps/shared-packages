import { decodePolyline } from './RegionMap.helpers';
import type { RegionMapCopy, RegionMapRegion } from './RegionMap.types';

/**
 * The copy and the areas every story and test shares.
 *
 * The areas are REAL: ten of Belo Horizonte's bairros as IBGE outlines them
 * (Malha de Bairros, Censo 2022; public data), coverage-simplified at ~11 m,
 * around a point in Venda Nova. Real shapes are what show the drawing's actual
 * problems — a hole that is another area, a sliver no finger can hit — which a
 * grid of squares never would.
 */

/** English, because stories are developer-facing. A consumer passes its own. */
export const REGION_MAP_COPY: RegionMapCopy = {
  mapLabel: 'Map of the neighbourhoods around the store',
  legendExcluded: 'Not delivered to',
  legendCircle: (metres) => `${(metres / 1000).toLocaleString('en-US')} km radius`,
  legendCenter: 'Store',
  listLabel: 'Neighbourhoods in reach · tap to toggle',
  showList: (count) => `See the ${count} neighbourhoods as a list`,
  hideList: 'Hide the list',
  rowState: { excluded: 'not delivered to', outside: 'outside the radius' },
};

/** The point the circles are drawn from. */
export const REGION_MAP_CENTER = { latitude: -19.8136, longitude: -43.9619 };

/** id, name, encoded outline (rings by `,`, polygons by `;`). */
const OUTLINES: readonly (readonly [string, string, string])[] = [
  ["3106200190", "Ceu Azul", "rc`xBxookGx@tNJbDtEW@ZsAlKCb@SK_BoBGhDM|D`EAh@^CbEOpGM|KoLpAoDt@iEdBiCr@QhAuBpJkAzIwFqAkG_AcARw@q@Nw@{@GgB_ELq@kCuF}Ag@]c@e@{Aq@w@{HjBu@ZgDpBy@\\yCl@cBTgEMg@NaB`Bk@t@Qx@uOgEOk@cB{As@kBuAc@Iu@VcAb@}@l@k@REtC_BrBeHFqBTwCJg@j@RbCmGfCzBhE`@`@n@dAd@`@}K_A]q@e@qBcA{Ak@`CyJ\\cBXa@r@c@tCq@`Bu@~EcBh@q@v@d@l@u@d@?x@gA|@cBlA{@|@[`AUhAKH`CbESNfCiD`@uAv@i@Ui@f@IUgAbALj@Ql@}@hB|@CrHq@nDyDbBFzW{AdY}A"],
  ["3106200365", "Serra Verde", "ryzwBnahkGw@`DaBbBaBpEyBpCOIgEjArBdJTl@x@hA}B~AmBjAiBzAoDbEkJaEa@E{@\\kBa@cBq@oAUgCI{A`@u@b@_Ch@y@b@uBnBoAf@w@p@kCRaGNy@YaAIeALmAv@]b@yEpEi@^yAXgAYcDO}@[c@eAoAy@IeAm@{BwBmDgAWoAg@wBuAi@}@yAIyAkBQ{@CaAVcAa@u@Lm@OoAu@e@uB@gAK_A[uCaBmAwASeA?qB`@iB?uAQiACcAa@s@Iy@k@wAWoAJa@E_AXqC\\a@Lu@GaDeC~@w@eDYgBZuCWmAY[zACd@ORq@yA@AoAbLYtH?vGNdFHfQVvBFrIFhEJzIXvRvAxHRhHJzC@lMV|a@t@zR\\CpAoCl@uBPmCx@qCxDgBvBk@h@_C|CcAzCy@vAuChA[b@,l}xwBprgkGA`LyBABmDIcFn@e@pAV"],
  ["3106200367", "Venda Nova", "le}wBltikGgAaBcAj@CrAyBtAoHdGsApAKb@_FKgApEy@nB{@zAqAhAmB}CdAaAt@kAd@kBrAmIp@yCPe@vAuBfAqA`A{Af@kAXyBFuAFwEXyAX_AxAcDtCeHx@eCpAuBnAgBnAyAlC}BrAy@lQaJf@]tAaBpIpGpNnKU`Dy@O[UiCiDkAeAqAy@cE{BeCcAiGjB?b@YzGuElAfAdDdBhCJdBa@zBlAdF_BfAe@r@s@rCc@dAoG~H]ZyDtE"],
  ["3106200418", "Santa Monica", "zq`xBhxlkGOp@a@AGr@_@z@w@`AsAjAe@Na@g@m@r@{FzE}@|@e@VyAXS_AqB`@T|@yElADPi@LRz@cB`@?`@sAE{C\\aBJm@RRbDm@FB\\iARGEsBhA{BhAuBhA{Ar@RoCi@UuD{CbAwAv@yCh@oCfGyAjGuAnA]gAeGc@oBc@JcAImEeApA}FaDmAaDs@uGcBeCk@oKmCeCiA}@s@iAoAgAgBa@cAu@wCeAcFy@cD?oAV_D`BpA`D~Cn@\\hORlAIfJiFvKkGj@_@PMpC{AzAs@`DiAhDqAfDkB?}Df@yAzA}B|OjEfB`@~HfCH~@A`BX`FV|GyBXqCp@cCTyAC[b@oBZv@rFRz@|@hCp@x@|AtAz@lAf@vAv@xAd@j@h@lATzAXlENxCF`DLD"],
  ["3106200457", "Vila Jardim Leblon", "xp~wBzdnkGBx@c@@LfEy@AYz@DwFBQzAs@;pn~wBlsnkGBh@x@EXzFa@BFv@m@@Ce@_@B[UEeA|@CGcBSyBR@"],
  ["3106200471", "Conjunto Minascaixa", "ryzwBnahkG`AhAfDhELVpCtDlFbHiFxBcA`@kAz@{BpBy@~AkAtCoDiA\\Up@cAREp@mAuBgAiAADr@eDqA_@t@e@b@Um@sBeJfEkANHxBqC`BqE`BcBv@aD"],
  ["3106200477", "Jardim Leblon", "f|~wBb~mkG^~@N|@hBGNUa@YS_CScDl@S`BKzC]rADr@KX`@l@LJ~AxAI@Tn@AIgA}@FOyBJq@bA_@RUbABhCa@l@]Dp@^Td@GNjAJjCfApTr@|M\\|Ey@FPlET~DeY|A{WzAcBGm@}@Ko@OgCcERIaC{@{QvAX`AvAfDODdAZT^CBd@l@AGw@`@CY{Fy@DCi@SAIqCX{@x@@MgEb@ACy@tBiAzBiArBiAFD,fz~wBrrnkGNbDaAFKqB|@y@,fz~wBrrnkGAM|BGGgAxBMKoAU[eBAG{AbAELd@rAtApBdBBNzFYIuB`AEJrB|@GUmDfAIB~Ab@jHx@E?TzDQJ[x@G\\tGT?D`AM`ALtA]DBt@uDRF`AQ?FfAW?F`A]BN`A}@FIgA[BAaAw@D@bAcDPKuBm@BAoAg@BAcAiCT_DJEeB_@sD_ADEs@hAEI{@x@GUaFaAFAo@{DP"],
  ["3106200479", "Lagoinha Leblon", "`g{wB|zpkG}N_@d@_VDqEJiFZ_TJyEbBt@zElA`@V|AZfA`@T}@iAa@JaAlCHh@Jz@`BrBfB|AbCUbB`@`@fDrEk@b@|AzChBpB}BrE[g@kAEyBbCeCCI`Cj@DcGzFwBGKhFK`C"],
  ["3106200482", "Mantiqueira", "x`ywBh{nkGiEg@mCPaBU]e@}@j@aDg@yAIe@a@SbAgBXqEQo@x@u@CY{@cCMc@y@wAGcBi@qCCWg@q@b@e@Bq@y@t@Bx@mC`AmE?_AYcEg@?a@iAEs@c@uB{@eDeBf@Vo@M_Am@MZw@Kk@s@KwD`AOgC|Bm@gAu@{@cLeAw@v@w@|@b@@a@]_FxBW~AGzARtA^tAsAxAWbBy@~Ag@bEY|@m@BWo@oAt@QfFhIJZk@b@_A\\V|@m@r@eA|@w@S[f@eCFYRoATcCsA]LXz@@r@bAAnAThAUR\\lDmAdAFxAqAFXfAFJfAf@GNg@AwA}@{A^y@l@KJ]Is@d@YSa@tDmBjBBZMbA_A~CS`BsA_B_B^{AlBmAbC|Bb@Xf@kA`Cu@nAe@RXtK~KzFiJH]`BA_A|Bt@~ApFfGtBo@vD{@@Tp@XfA}AJ_@hAv@fBoAvCnEUnMo@jc@k@?qA`@k@^c@lAAjJO~G[vAy@vA]hAqMoB{Ew@oEk@{Do@i@EIhAuJoAUdC,njywBzsnkGx@Mv@F?g@p@F?PlALFu@o@AQ}@?cAW@Dh@mA`@q@fAOs@}@Og@DBf@`@Dh@x@"],
  ["3106200484", "Minascaixa", "r~|wBzahkGqAtBy@dCuCdHyAbDY~@YxAGvEGtAYxBg@jAaAzAgApAwAtBQd@eCeCmBoAyDqCeHoEwEuCoB{AhFyBmFcHqCuDMWgDiEaAiAZc@tCiAx@wAbA{C~B}Cj@i@fBwBpCyDlCy@tBQnCm@BqArB?tEPj@AAx@o@Nm@f@tFjGxBdGnA~AzI~H"],
];

/** The areas, decoded, none excluded. */
export const REGION_MAP_AREAS: RegionMapRegion[] = OUTLINES.map(([id, name, outline]) => ({
  id,
  name,
  rings: outline
    .split(';')
    .flatMap((polygon) => polygon.split(','))
    .map((ring) => decodePolyline(ring)),
}));

/**
 * Context outside the circle: three of the areas marked `outside` — drawn
 * faded, left off the list — and one tagged as too small to tap.
 */
export const REGION_MAP_WITH_CONTEXT: RegionMapRegion[] = REGION_MAP_AREAS.map((area) => ({
  ...area,
  outside: ['Ceu Azul', 'Lagoinha Leblon', 'Mantiqueira'].includes(area.name),
  detail: area.name === 'Vila Jardim Leblon' ? 'tiny' : undefined,
}));

/** The same areas with two of them excluded. */
export const REGION_MAP_WITH_EXCLUSIONS: RegionMapRegion[] = REGION_MAP_AREAS.map((area) => ({
  ...area,
  excluded: area.name === 'Minascaixa' || area.name === 'Jardim Leblon',
}));
