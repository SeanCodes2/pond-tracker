/**
 * Entry point for the Azure Functions v4 programming model.
 * Importing each module registers its functions via `app.http(...)`.
 */
import './functions/health';
import './functions/sync';
import './functions/photos';
