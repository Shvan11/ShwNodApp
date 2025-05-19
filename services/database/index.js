/**
 * Database service
 * Provides methods for database operations
 */
import { Connection, Request, TYPES } from 'tedious';
import config from '../../config/config.js';

/**
 * Helper function to execute a SQL query and map the results.
 * @param {string} query - The SQL query to execute.
 * @param {Array} params - An array of arrays. Each array represents one parameter.
 * @param {Function} rowMapper - A function to map each row of the result set.
 * @param {Function} [resultMapper] - An optional function to map the final result.
 * @returns {Promise<any>} - A promise that resolves with the mapped result.
 */
function executeQuery(query, params, rowMapper, resultMapper = (result) => result) {
  return new Promise((resolve, reject) => {
    const connection = new Connection(config.database);
    const request = new Request(query, (err) => {
      if (err) {
        reject(err);
        return;
      }
    });

    (params || []).forEach((param) => {
      request.addParameter(param[0], param[1], param[2]);
    });

    const result = [];
    request.on('row', (columns) => {
      result.push(rowMapper ? rowMapper(columns) : columns);
    });

    const outputParams = [];
    request.on('returnValue', (parameterName, value) => {
      outputParams.push({ parameterName, value });
      console.log(`${parameterName} = ${value}`);
    });

    connection.on('connect', (err) => {
      if (err) {
        reject(err);
        return;
      }
      connection.execSql(request);
    });

    request.on('requestCompleted', () => {
      resolve(resultMapper(result, outputParams));
      connection.close();
    });

    connection.connect();
  });
}

/**
 * Helper function to execute a stored procedure and map the results.
 * @param {string} procedureName - The name of the stored procedure to execute.
 * @param {Array} params - An array of parameter arrays, each containing name, type, and value.
 * @param {Function} [beforeExec] - An optional function to configure the request before execution.
 * @param {Function} [rowMapper] - A function to map each row of the result set.
 * @param {Function} [resultMapper] - A function to map the final result.
 * @returns {Promise<any>} - A promise that resolves with the mapped result.
 */
function executeStoredProcedure(procedureName, params, beforeExec, rowMapper, resultMapper) {
  return new Promise((resolve, reject) => {
    const connection = new Connection(config.database);
    const request = new Request(procedureName, (err) => {
      if (err) {
        reject(err);
        return;
      }
    });

    (params || []).forEach((param) => {
      request.addParameter(param[0], param[1], param[2]);
    });

    if (beforeExec) {
      beforeExec(request);
    }

    const result = [];
    request.on('row', (columns) => {
      result.push(rowMapper ? rowMapper(columns) : columns);
    });

    const outParams = [];
    request.on('returnValue', (parameterName, value) => {
      outParams.push({ parameterName, value });
    });

    connection.on('connect', (err) => {
      if (err) {
        reject(err);
        return;
      }
      connection.callProcedure(request);
    });

    request.on('requestCompleted', () => {
      resolve(resultMapper ? resultMapper(result, outParams) : result);
      connection.close();
    });

    connection.connect();
  });
}

export { executeQuery, executeStoredProcedure, TYPES };
