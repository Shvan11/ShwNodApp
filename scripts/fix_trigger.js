import { Connection, Request, TYPES } from 'tedious';
import config from '../config/config.js';

const dbConfig = {
  server: config.database.server,
  authentication: {
    type: 'default',
    options: {
      userName: config.database.user,
      password: config.database.password,
    }
  },
  options: {
    database: config.database.database,
    encrypt: config.database.encrypt,
    trustServerCertificate: config.database.trustServerCertificate,
    instanceName: config.database.instanceName,
    connectTimeout: 30000,
    requestTimeout: 30000,
  }
};

const triggerSQL = `
CREATE TRIGGER [dbo].[trg_ValidateAlignerBatchCounts]
ON [dbo].[tblAlignerBatches]
INSTEAD OF INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- For INSERT operations (no matching record in 'deleted')
    IF EXISTS (SELECT 1 FROM inserted WHERE NOT EXISTS (
        SELECT 1 FROM deleted WHERE deleted.AlignerBatchID = inserted.AlignerBatchID))
    BEGIN
        -- Check if any new batch exceeds remaining aligners
        IF EXISTS (
            SELECT 1
            FROM inserted i
            JOIN dbo.tblAlignerSets s ON i.AlignerSetID = s.AlignerSetID
            WHERE i.UpperAlignerCount > s.RemainingUpperAligners
               OR i.LowerAlignerCount > s.RemainingLowerAligners
        )
        BEGIN
            RAISERROR('Cannot add aligner batch: requested aligners exceed the remaining count in the set.', 16, 1);
            RETURN;
        END

        -- Perform the actual insert with ALL columns
        INSERT INTO [dbo].[tblAlignerBatches] (
            AlignerSetID,
            UpperAlignerCount,
            LowerAlignerCount,
            ManufactureDate,
            DeliveredToPatientDate,
            Notes,
            IsActive,
            Days,
            BatchSequence,
            UpperAlignerStartSequence,
            LowerAlignerStartSequence,
            UpperAlignerEndSequence,
            LowerAlignerEndSequence,
            ValidityPeriod,
            NextBatchReadyDate
        )
        SELECT
            AlignerSetID,
            UpperAlignerCount,
            LowerAlignerCount,
            ManufactureDate,
            DeliveredToPatientDate,
            Notes,
            IsActive,
            Days,
            BatchSequence,
            UpperAlignerStartSequence,
            LowerAlignerStartSequence,
            UpperAlignerEndSequence,
            LowerAlignerEndSequence,
            ValidityPeriod,
            NextBatchReadyDate
        FROM inserted;
    END
    -- For UPDATE operations
    ELSE
    BEGIN
        -- Validate updates against available remaining counts
        IF EXISTS (
            SELECT 1
            FROM inserted i
            JOIN deleted d ON i.AlignerBatchID = d.AlignerBatchID
            JOIN dbo.tblAlignerSets s ON i.AlignerSetID = s.AlignerSetID
            WHERE i.UpperAlignerCount > s.RemainingUpperAligners + d.UpperAlignerCount
               OR i.LowerAlignerCount > s.RemainingLowerAligners + d.LowerAlignerCount
        )
        BEGIN
            RAISERROR('Cannot update aligner batch: requested aligners exceed the remaining count in the set.', 16, 1);
            RETURN;
        END

        -- Perform the actual update with ALL columns
        UPDATE a
        SET
            a.AlignerSetID = i.AlignerSetID,
            a.UpperAlignerCount = i.UpperAlignerCount,
            a.LowerAlignerCount = i.LowerAlignerCount,
            a.ManufactureDate = i.ManufactureDate,
            a.DeliveredToPatientDate = i.DeliveredToPatientDate,
            a.Notes = i.Notes,
            a.IsActive = i.IsActive,
            a.Days = i.Days,
            a.BatchSequence = i.BatchSequence,
            a.UpperAlignerStartSequence = i.UpperAlignerStartSequence,
            a.LowerAlignerStartSequence = i.LowerAlignerStartSequence,
            a.UpperAlignerEndSequence = i.UpperAlignerEndSequence,
            a.LowerAlignerEndSequence = i.LowerAlignerEndSequence,
            a.ValidityPeriod = i.ValidityPeriod,
            a.NextBatchReadyDate = i.NextBatchReadyDate
        FROM [dbo].[tblAlignerBatches] a
        JOIN inserted i ON a.AlignerBatchID = i.AlignerBatchID;
    END
END
`;

const connection = new Connection(dbConfig);

connection.on('connect', (err) => {
  if (err) {
    console.error('Connection error:', err);
    process.exit(1);
  }

  console.log('Connected to database. Creating trigger...');

  const request = new Request(triggerSQL, (err) => {
    if (err) {
      console.error('Error creating trigger:', err);
      connection.close();
      process.exit(1);
    }
  });

  request.on('requestCompleted', () => {
    console.log('✓ Trigger created successfully!');
    connection.close();
  });

  connection.execSql(request);
});

connection.connect();
