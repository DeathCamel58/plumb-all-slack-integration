const assert = require("assert");
const DataUtilities = require("../util/DataUtilities.js");
const { describe, it, expect } = require("@jest/globals");

// We can group similar tests inside a `describe` block
describe("Data Utilities", () => {
  // Test Phone Number Cleanup
  describe("Phone Number Cleanup", () => {
    it("Normalize Phone Number (spaces)", () => {
      let normalized = DataUtilities.normalizePhoneNumber(
        "2 3 4 5 6 7 8 9 0 1",
      );
      assert.equal(normalized, "(234) 567-8901");
    });
    it("Normalize Phone Number (leading and trailing spaces)", () => {
      let normalized = DataUtilities.normalizePhoneNumber(" 2345678901 ");
      assert.equal(normalized, "(234) 567-8901");
    });
    it("Normalize Phone Number (hyphens)", () => {
      let normalized = DataUtilities.normalizePhoneNumber("234-567-8901");
      assert.equal(normalized, "(234) 567-8901");
    });
    it("Normalize Phone Number (+1 prefix)", () => {
      let normalized = DataUtilities.normalizePhoneNumber("+1 123-456-7890");
      assert.equal(normalized, "(123) 456-7890");
    });
    it("Normalize Phone Number (extension)", () => {
      let normalized = DataUtilities.normalizePhoneNumber("234-567-8901 7102");
      assert.equal(normalized, "(234) 567-8901 x7102");
    });
    it("Normalize Phone Number (bad number)", () => {
      let normalized = DataUtilities.normalizePhoneNumber("TEST STRING");
      assert.equal(normalized, null);
    });
  });
  // Test Interleave
  describe("Interleaving", () => {
    it("Add null between", () => {
      let array = ["This", "is", "a", "test"];
      let newArray = DataUtilities.interleave(array, null);
      expect(newArray).toEqual(["This", null, "is", null, "a", null, "test"]);
    });
    it("Add string between", () => {
      let array = ["This", "is", "a", "test"];
      let newArray = DataUtilities.interleave(array, "TEST");
      expect(newArray).toEqual([
        "This",
        "TEST",
        "is",
        "TEST",
        "a",
        "TEST",
        "test",
      ]);
    });
    it("Add dictionary between", () => {
      let array = ["This", "is", "a", "test"];
      let dict = { value: "test" };
      let newArray = DataUtilities.interleave(array, dict);
      expect(newArray).toEqual([
        "This",
        { value: "test" },
        "is",
        { value: "test" },
        "a",
        { value: "test" },
        "test",
      ]);
    });
  });
});
