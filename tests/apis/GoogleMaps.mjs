import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const geocodeMock = jest.fn();

jest.unstable_mockModule("@googlemaps/google-maps-services-js", () => ({
  Client: jest.fn().mockImplementation(() => ({
    geocode: geocodeMock,
  })),
}));

const GoogleMaps = await import("../../util/apis/GoogleMaps.js");

describe("Google Maps", () => {
  beforeEach(() => {
    geocodeMock.mockReset();
  });

  describe("Search for Location", () => {
    test("Valid Location (good request)", async () => {
      geocodeMock.mockResolvedValue({
        data: {
          results: [
            {
              formatted_address: "206 Washington St SW, Atlanta, GA 30334, USA",
            },
          ],
        },
      });

      const response = await GoogleMaps.searchPlace(
        "206 Washington St SW, Atlanta GA, 30334",
      );

      expect(response.length).toBeGreaterThan(0);
      expect(geocodeMock).toHaveBeenCalledTimes(1);
      expect(geocodeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            address: "206 Washington St SW, Atlanta GA, 30334",
          }),
        }),
      );
    });

    test("Valid Location (bad request)", async () => {
      geocodeMock.mockResolvedValue({
        data: {
          results: [],
        },
      });

      const response = await GoogleMaps.searchPlace("-, - -, -");
      expect(response).toBeNull();
    });

    test("API error returns null", async () => {
      geocodeMock.mockRejectedValue(new Error("geocode failed"));

      const response = await GoogleMaps.searchPlace("broken");
      expect(response).toBeNull();
    });
  });
});
