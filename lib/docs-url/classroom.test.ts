// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { buildGradingPath, parseClassroomLocation } from "./classroom";

// Real-shaped ids from the live educator capture (2026-06-19).
const CLASS = "MjM0MzU5OTY5MTJa";
const ASSIGN = "MjIxNzAyMzg4NDNa";
const STUDENT = "MjY2ODUxODA2NTFa";

describe("parseClassroomLocation — grading view", () => {
  test("parses /g/tg/ with authuser query and #u= student", () => {
    expect(
      parseClassroomLocation(
        `https://classroom.google.com/g/tg/${CLASS}/${ASSIGN}?authuser=0#u=${STUDENT}`,
      ),
    ).toEqual({
      view: "grading",
      classId: CLASS,
      assignmentId: ASSIGN,
      studentId: STUDENT,
      userIndex: 0,
    });
  });

  test("parses the post-redirect form (#u=…&t=f, no authuser) with null slot", () => {
    expect(
      parseClassroomLocation(
        `https://classroom.google.com/g/tg/${CLASS}/${ASSIGN}#u=${STUDENT}&t=f`,
      ),
    ).toEqual({
      view: "grading",
      classId: CLASS,
      assignmentId: ASSIGN,
      studentId: STUDENT,
      userIndex: null,
    });
  });

  test("carries a non-zero authuser slot", () => {
    expect(
      parseClassroomLocation(
        `https://classroom.google.com/g/tg/${CLASS}/${ASSIGN}?authuser=2#u=${STUDENT}`,
      )?.userIndex,
    ).toBe(2);
  });

  test("returns a null studentId when the fragment has no #u=", () => {
    expect(
      parseClassroomLocation(`https://classroom.google.com/g/tg/${CLASS}/${ASSIGN}`)?.studentId,
    ).toBeNull();
  });
});

describe("parseClassroomLocation — submission-status view", () => {
  test("parses /c/…/a/…/submissions/…/student/… into the three ids", () => {
    expect(
      parseClassroomLocation(
        `https://classroom.google.com/c/${CLASS}/a/${ASSIGN}/submissions/by-status/and-sort-first-name/student/${STUDENT}`,
      ),
    ).toEqual({
      view: "submission",
      classId: CLASS,
      assignmentId: ASSIGN,
      studentId: STUDENT,
      userIndex: null,
    });
  });

  test("picks up the authuser slot when the submission URL carries one", () => {
    expect(
      parseClassroomLocation(
        `https://classroom.google.com/c/${CLASS}/a/${ASSIGN}/submissions/by-status/x/student/${STUDENT}?authuser=1`,
      )?.userIndex,
    ).toBe(1);
  });
});

describe("parseClassroomLocation — rejects non-targets", () => {
  test("returns null for the Classroom home page", () => {
    expect(parseClassroomLocation("https://classroom.google.com/h")).toBeNull();
  });

  test("returns null for a plain class stream", () => {
    expect(parseClassroomLocation(`https://classroom.google.com/c/${CLASS}`)).toBeNull();
  });

  test("returns null for a Docs document URL", () => {
    expect(parseClassroomLocation("https://docs.google.com/document/d/1z6Y_abc/edit")).toBeNull();
  });

  test("returns null for an unparseable input", () => {
    expect(parseClassroomLocation("not a url at all")).toBeNull();
  });
});

describe("buildGradingPath", () => {
  test("builds a path-relative deep link with authuser and #u= fragment", () => {
    expect(
      buildGradingPath({
        classId: CLASS,
        assignmentId: ASSIGN,
        studentId: STUDENT,
        userIndex: 0,
      }),
    ).toBe(`/g/tg/${CLASS}/${ASSIGN}?authuser=0#u=${STUDENT}`);
  });

  test("omits authuser for the default (null) account slot", () => {
    expect(
      buildGradingPath({
        classId: CLASS,
        assignmentId: ASSIGN,
        studentId: STUDENT,
        userIndex: null,
      }),
    ).toBe(`/g/tg/${CLASS}/${ASSIGN}#u=${STUDENT}`);
  });

  test("emits no scheme/host (resolves against the current origin)", () => {
    const path = buildGradingPath({
      classId: CLASS,
      assignmentId: ASSIGN,
      studentId: STUDENT,
      userIndex: 1,
    });
    expect(path.startsWith("/")).toBe(true);
    expect(path).not.toContain("://");
  });

  test("round-trips through parseClassroomLocation", () => {
    const path = buildGradingPath({
      classId: CLASS,
      assignmentId: ASSIGN,
      studentId: STUDENT,
      userIndex: 3,
    });
    expect(parseClassroomLocation(`https://classroom.google.com${path}`)).toEqual({
      view: "grading",
      classId: CLASS,
      assignmentId: ASSIGN,
      studentId: STUDENT,
      userIndex: 3,
    });
  });
});
