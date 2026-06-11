// SPDX-License-Identifier: AGPL-3.0-or-later
//
// SANITIZED live-capture fixture (PRD §11.5, §15.3; plan R4 tier [x:live]).
//
// Captured 2026-06-12 from a throwaway Google Doc via an authenticated
// `revisions/load` read during the §24 transport capture (see
// docs/protocol-capture.md). This is the FIRST fixture taken from the real 2026
// wire format rather than the hand-authored A.2 grammar — it exercises the live
// 9-element changelog TUPLE envelope `[op, time, sessionId, revisionId, userId, …]`
// that the synthetic corpus (corpus.ts, flat-object entries) does not model.
//
// SANITIZATION (PRD §11.5, §13.7): every identifying field is redacted to a
// structural placeholder — `time` → a synthetic monotonic stamp, `sessionId` →
// "sess-redacted", `userId` → "user-redacted". The operation `s` strings are the
// throwaway filler the capturing maintainer typed themselves ("Probe one two
// three." / " Second sentence." / " Third one."), NOT third-party content, so
// they are committed verbatim — that is what makes the end-of-timeline
// text-equality proof (PRD §15.3) honest rather than tautological.
//
// The op inventory seen live: `mlti` (revision 1 wraps document/heading setup),
// `as` (ApplyStyle — the A.2 "secondary" style op; the text decoder isolates it
// via the open-world UnknownOp path), and `is` (the three text insertions).

/**
 * One sanitized real-capture fixture: the framed-and-parsed `{ changelog }`
 * envelope exactly as decoded off the wire (tuple entries), plus the document's
 * verbatim end-of-timeline text. `changelog` is typed `unknown[]` because the
 * raw wire shape is intentionally untyped until it passes through the decoder.
 */
export interface CapturedFixture {
  readonly name: string;
  readonly capturedAt: string;
  /** The parsed top-level payload, shaped { changelog }, as `detectSchema` sees it. */
  readonly envelope: { readonly changelog: readonly unknown[] };
  /** Verbatim current text of the source doc (maintainer-typed filler). */
  readonly expectedFinalText: string;
}

const CHANGELOG: readonly unknown[] = [
  [
    {
      ty: "mlti",
      mts: [
        {
          ty: "as",
          st: "document",
          si: 0,
          ei: 0,
          sm: {
            ds_pw: 595.4399999999999,
            ds_lhs: 1,
            ds_ulhfl: false,
            ds_ph: 841.68,
          },
        },
        {
          ty: "as",
          st: "headings",
          si: 0,
          ei: 0,
          sm: {
            hs_h3: {
              sdef_ps: {
                ps_sb_i: false,
                ps_sb: 16,
              },
              sdef_ts: {
                ts_bd_i: false,
                ts_bd: false,
                ts_fgc2: {
                  hclr_color: "#434343",
                  clr_type: 0,
                },
                ts_fgc2_i: false,
              },
            },
            hs_h2: {
              sdef_ps: {
                ps_sa_i: false,
                ps_sa: 6,
              },
              sdef_ts: {
                ts_bd_i: false,
                ts_fs: 16,
                ts_bd: false,
                ts_fs_i: false,
              },
            },
            hs_t: {
              sdef_ps: {
                ps_sb_i: false,
                ps_sa_i: false,
                ps_sa: 3,
                ps_sb: 0,
              },
              sdef_ts: {
                ts_bd_i: true,
                ts_fs: 26,
                ts_bd: false,
                ts_fs_i: false,
              },
            },
            hs_h1: {
              sdef_ps: {
                ps_sb_i: false,
                ps_sb: 20,
              },
              sdef_ts: {
                ts_bd_i: true,
                ts_fs: 20,
                ts_bd: false,
                ts_fs_i: false,
              },
            },
            hs_nt: {
              sdef_ps: {
                ps_lslm: 1,
                ps_lslm_i: false,
                ps_sm: 0,
                ps_sm_i: false,
              },
            },
            hs_st: {
              sdef_ps: {
                ps_sb_i: false,
                ps_sa_i: false,
                ps_sa: 16,
                ps_sb: 0,
              },
              sdef_ts: {
                ts_ff_i: false,
                ts_it: false,
                ts_fs: 15,
                ts_ff: "Arial",
                ts_it_i: false,
                ts_fs_i: false,
              },
            },
            hs_h6: {
              sdef_ps: {
                ps_sb_i: false,
                ps_sa_i: false,
                ps_sa: 4,
                ps_sb: 12,
              },
              sdef_ts: {
                ts_it: true,
                ts_bd_i: true,
                ts_fs: 11,
                ts_it_i: false,
                ts_bd: false,
                ts_fgc2: {
                  hclr_color: "#666666",
                  clr_type: 0,
                },
                ts_fgc2_i: false,
                ts_fs_i: false,
              },
            },
            hs_h5: {
              sdef_ps: {
                ps_sb_i: false,
                ps_sa_i: false,
                ps_sa: 4,
                ps_sb: 12,
              },
              sdef_ts: {
                ts_bd_i: true,
                ts_bd: false,
                ts_fgc2: {
                  hclr_color: "#666666",
                  clr_type: 0,
                },
                ts_fgc2_i: false,
              },
            },
            hs_h4: {
              sdef_ps: {
                ps_sb_i: false,
                ps_sa_i: false,
                ps_sa: 4,
                ps_sb: 14,
              },
              sdef_ts: {
                ts_bd_i: true,
                ts_bd: false,
                ts_fgc2: {
                  hclr_color: "#666666",
                  clr_type: 0,
                },
                ts_fgc2_i: false,
              },
            },
          },
        },
        {
          ty: "as",
          st: "language",
          si: 0,
          ei: 0,
          sm: {
            lgs_l: "en_GB",
          },
        },
        {
          ty: "as",
          st: "paragraph",
          si: 1,
          ei: 1,
          sm: {
            ps_awao_i: true,
            ps_klt_i: true,
            ps_sm_i: true,
            ps_ls_i: true,
            ps_il_i: true,
            ps_ir_i: true,
            ps_al_i: true,
            ps_bl_i: true,
            ps_sd_i: true,
            ps_sb_i: true,
            ps_sa_i: true,
            ps_lslm_i: true,
            ps_br_i: true,
            ps_bbtw_i: true,
            ps_bt_i: true,
            ps_kwn_i: true,
            ps_bb_i: true,
            ps_ifl_i: true,
            ps_pbb_i: true,
          },
        },
        {
          ty: "as",
          st: "text",
          si: 0,
          ei: 1,
          sm: {
            ts_ff_i: true,
            ts_un_i: true,
            ts_bgc2_i: true,
            ts_bd_i: true,
            ts_va_i: true,
            ts_it_i: true,
            ts_fgc2_i: true,
            ts_sc_i: true,
            ts_st_i: true,
            ts_fs_i: true,
          },
        },
      ],
    },
    1700000000000,
    "sess-redacted",
    1,
    null,
    null,
    null,
    null,
    false,
  ],
  [
    {
      ty: "is",
      ibi: 1,
      s: "Probe one two three.",
    },
    1700000001000,
    "sess-redacted",
    2,
    "user-redacted",
    0,
    null,
    null,
    false,
  ],
  [
    {
      ty: "is",
      ibi: 21,
      s: " Second sentence.",
    },
    1700000002000,
    "sess-redacted",
    3,
    "user-redacted",
    1,
    null,
    null,
    false,
  ],
  [
    {
      ty: "is",
      ibi: 38,
      s: " Third one.",
    },
    1700000003000,
    "sess-redacted",
    4,
    "user-redacted",
    2,
    null,
    null,
    false,
  ],
];

export const CAPTURED_SIMPLE_DOC: CapturedFixture = {
  name: "live-simple-doc (mlti+as setup, three is inserts)",
  capturedAt: "2026-06-12",
  envelope: { changelog: CHANGELOG },
  expectedFinalText: "Probe one two three. Second sentence. Third one.",
};
