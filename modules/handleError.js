/**
 * @module handleError
 * @memberof module:dka-calculator-api
 * @summary Module for handling errors.
 *
 * @exports handleError Object containing the different routes available in the feedback module
 */

/**
 * @function handleError
 * @summary Handles and logs errors, optionally sending a response and alert email.
 * @description
 * Logs the error with a timestamp, sends an appropriate response to the client (either HTML or JSON),
 * and optionally emails a status 500 error report to the configured admin email.
 *
 * Errors should be thrown within route modules as --> throw Object.assign(new Error("My custom message"), { statusCode: 400 });
 * Or for status 500 can be just throw new Error("My custom message")
 *
 * @requires ../config Config file including email for error message
 *
 * @param {Error} error - The error object to handle.
 * @param {number} [statusCode=500] - The HTTP status code to send with the response.
 * @param {string} [route="undefinedRoute"] - The route where the error occurred.
 * @param {string} [routeMsg="API failed at unknown route"] - A custom message describing the error context.
 * @param {object} res - The Express.js response object for sending the error response.
 * @param {array} [info=[]] - An array of additional informational strings such as a audit ID or request parameter.
 * @throws {Error} - If email sending fails, this function may throw an error.
 */
function handleError(
  error,
  statusCode = 500,
  route = "undefinedRoute",
  routeMsg = "API failed at unknown route",
  res,
  info = []
) {
  // Log the error with a timestamp for debugging
  delete error.statusCode;
  const errorTime = new Date().toISOString();

  console.error(errorTime, `${route} ${statusCode}`, [info.join(" | ")], error);

  const config = require("../config.json");

  // Send response with the error message
  if (res) {
    res.status(statusCode).json({
      errors: [{ msg: `${routeMsg}: ` + error.message }],
    });
  }

  // Send email alert if unexpected error
  if (statusCode === 500) {
    html = `
          <p>route: ${route}<br>
          errorMessage: ${error.message}<br>
          errorTime: ${errorTime}<br>
          info: [${info.join(" | ")}]<br>
          </p>
        `;
    sendMail(
      config.author.email,
      "DKA Calculator status 500 error report",
      html
    );
  }
  
  console.error(" ");
}

/**
 * @async
 * @function sendMail
 * @memberof module:mailUtilities
 * @summary Sends an email using Nodemailer.
 *
 * @param {string} email - The recipient's email address.
 * @param {string} subject - The subject line of the email.
 * @param {string} html - The HTML content of the email.
 * @returns {Promise<boolean>} - Returns a promise that resolves to `true` if the email was sent successfully, or `false` if an error occurred.
 */
const sendMail = async (email, subject, html) => {
  const config = require("../config.json");
  if (config.underDevelopment) {
    console.error("Dev mode active: error email notifications disabled");
    return false;
  }

  const nodemailer = require("nodemailer");

  // Configure the email transporter using Nodemailer
  const transporter = nodemailer.createTransport({
    host: "mail.dka-calculator.co.uk",
    port: 465,
    secure: true, // true for port 465, false for other ports
    auth: {
      user: config.author.email,
      pass: process.env.emailKey,
    },
    dkim: {
      domainName: "dka-calculator.co.uk",
      privateKey: process.env.emailDkimPrivateKey,
    },
  });

  // Email options including the recipient, subject, HTML content, and attachments
  const mailOptions = {
    from: "admin@dka-calculator.co.uk",
    to: email,
    subject: subject,
    html: html,
  };

  // Send the email using the transporter
  await transporter.sendMail(mailOptions);

  return true;
};

module.exports = { handleError };
