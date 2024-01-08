// const Contact = require("../contact");
// const GoogleMaps = require("./GoogleMaps");
const APICoordinator = require("../APICoordinator");
const SlackBot = require("./SlackBot");

/**
 * Processes a FleetSharp Alert webhook
 * @param body the data that was received
 * @returns {Promise<void>}
 * @constructor
 */
async function AlertHandle(body) {
    console.log("Data was");
    console.log(body);

    // let contact = new Contact("Message From Website", body.name, body.phone, undefined, body.email, body.address, body.message, "Website");
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
        case 'HIGH_SPEED':
            // `HIGH_SPEED` is only fired if speed is above the configured one in Setup->Alert Settings->General Settings->High Speed Threshold
            message = `Vehicle ${body.firstName} ${body.lastName} (VIN: \`${body.vin}\`) was going over 85. Chill out dude.`;
            break;
        default:
            console.info(`Was a ${body.alertCode} alert.`);
            break;
    }

    if (message !== '') {
        // Send the request to where it needs to go
        await SlackBot.sendMessage(message, `FleetSharp Alert`);
    }
}

module.exports = {
    AlertHandle
};
