import events from "../events.js";

/**
 * Processes a FleetSharp Alert webhook
 * @param req The incoming web data
 * @returns {Promise<void>}
 * @constructor
 */
async function AlertHandle(req) {
  let body = JSON.parse(req.body);

  if (process.env.DEBUG === "TRUE") {
    console.log("FleetSharp: Data was");
    console.log(body);
  }

  let message;
  switch (body.alertCode) {
    // NOTE: These are the available alerts
    //   FIRST_IGNITION_OF_DAY
    //   GEOFENCE_ENTERED
    //   GEOFENCE_EXITED
    //   HARSH_BRAKING
    //   HIGH_SPEED – Vehicle has exceeded a hard upper limit set by the customer
    //   SPEEDING - Vehicle has exceeded the posted speed limit (including buffer)
    //   IDLE_START – Vehicle has started idling (engine on, not moving)
    //   IDLE_END
    //   NO_SIGNAL – Device has not reported in (12 hours for vehicles, 50 for assets)
    //   RAPID_ACCELERATION
    //   SENSOR_USE_EXCEEDS_LIMIT – Sensor has gone HIGH more than allowed limit
    //   SENSOR_UNAUTHORIZED_USE – Sensor has gone HIGH outside authorized hours
    //   POWER_ON – Device has powered on (this is also known as TAMPER)
    //   UNAUTHORIZED_USE – Vehicle is being used outside authorized hours
    //   ASSET_LOW_BATTERY
    //   DIAGNOSTIC_TROUBLE_CODE_NEW – Vehicle has thrown a new diagnostic code
    //   DIAGNOSTIC_TROUBLE_CODE_CLEAR – Vehicle has cleared a diagnostic code
    //   SENSOR_ONE_HIGH
    //   SENSOR_ONE_LOW
    //   SENSOR_TWO_HIGH
    //   SENSOR_TWO_LOW
    case "HIGH_SPEED":
      // `HIGH_SPEED` is only fired if speed is above the configured one in Setup->Alert Settings->General Settings->High Speed Threshold
      message = `Vehicle ${body.firstName} ${body.lastName} (VIN: \`${body.vin}\`) was going 85 or faster. Chill out dude.`;
      break;
    // case 'RAPID_ACCELERATION':
    //     // `RAPID_ACCELERATION` is fired when people gas it too hard
    //     message = `Vehicle ${body.firstName} ${body.lastName} (VIN: \`${body.vin}\`) rapidly accelerated. Quit flooring it.`;
    //     break;
    default:
      console.info(`FleetSharp: Got a ${body.alertCode} alert.`);
      break;
  }

  if (message !== undefined) {
    // Send the request to where it needs to go
    events.emit(
      "slackbot-send-message",
      message,
      "FleetSharp Alert",
      process.env.SLACK_CHANNEL_GENERAL,
    );
    events.emit(
      "mattermost-send-message",
      message,
      "FleetSharp Alert",
      process.env.MATTERMOST_CHANNEL_GENERAL,
    );
  }
}
events.on("fleetsharp-alert", AlertHandle);
