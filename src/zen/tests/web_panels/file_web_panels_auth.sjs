/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// Basic auth for "zen" / "panel".
const CREDENTIALS = "Basic emVuOnBhbmVs";

function handleRequest(request, response) {
  response.setHeader("Content-Type", "text/html", false);

  if (
    request.hasHeader("Authorization") &&
    request.getHeader("Authorization") === CREDENTIALS
  ) {
    response.write("<title>authenticated</title>");
    return;
  }

  response.setStatusLine(request.httpVersion, 401, "Unauthorized");
  response.setHeader("WWW-Authenticate", 'Basic realm="web panels"', false);
  response.write("<title>unauthorized</title>");
}
