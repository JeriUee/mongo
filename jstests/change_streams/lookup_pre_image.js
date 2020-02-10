/**
 * Tests the behaviour of the 'fullDocumentBeforeChange' argument to the $changeStream stage.
 *
 * @tags: [
 *   do_not_wrap_aggregations_in_facets,
 *   uses_multiple_connections,
 *   requires_fcv_44,
 *   assumes_against_mongod_not_mongos,
 *   assumes_unsharded_collection
 * ]
 */
(function() {
"use strict";

load("jstests/libs/change_stream_util.js");        // For ChangeStreamTest.
load("jstests/libs/collection_drop_recreate.js");  // For assert[Drop|Create]Collection.
load("jstests/libs/fixture_helpers.js");           // For FixtureHelpers.

const coll = assertDropAndRecreateCollection(db, "change_stream_pre_images");
const cst = new ChangeStreamTest(db);

// Enable pre-image recording on the test collection.
assert.commandWorked(db.runCommand({collMod: coll.getName(), recordPreImages: true}));

// Open three streams on the collection, one for each "fullDocumentBeforeChange" mode.
const csNoPreImages = cst.startWatchingChanges({
    collection: coll,
    pipeline: [{$changeStream: {"fullDocumentBeforeChange": "off", fullDocument: "updateLookup"}}]
});
const csPreImageWhenAvailableCursor = cst.startWatchingChanges({
    collection: coll,
    pipeline: [
        {$changeStream: {"fullDocumentBeforeChange": "whenAvailable", fullDocument: "updateLookup"}}
    ]
});
const csPreImageRequiredCursor = cst.startWatchingChanges({
    collection: coll,
    pipeline:
        [{$changeStream: {fullDocumentBeforeChange: "required", fullDocument: "updateLookup"}}]
});

// Test pre-image lookup for an insertion. No pre-image exists on any cursor.
assert.commandWorked(coll.insert({_id: "x"}));
let latestChange = cst.getOneChange(csNoPreImages);
assert.eq(latestChange.operationType, "insert");
assert(!latestChange.hasOwnProperty("fullDocumentBeforeChange"));
assert.docEq(latestChange.fullDocument, {_id: "x"});
assert.docEq(latestChange, cst.getOneChange(csPreImageWhenAvailableCursor));
assert.docEq(latestChange, cst.getOneChange(csPreImageRequiredCursor));

// Test pre-image lookup for a replacement operation.
assert.commandWorked(coll.update({_id: "x"}, {foo: "bar"}));
latestChange = cst.getOneChange(csNoPreImages);
assert.eq(latestChange.operationType, "replace");
assert(!latestChange.hasOwnProperty("fullDocumentBeforeChange"));
assert.docEq(latestChange.fullDocument, {_id: "x", foo: "bar"});
// Add the expected "fullDocumentBeforeChange" and confirm that both pre-image cursors see it.
latestChange.fullDocumentBeforeChange = {
    _id: "x"
};
assert.docEq(latestChange, cst.getOneChange(csPreImageWhenAvailableCursor));
assert.docEq(latestChange, cst.getOneChange(csPreImageRequiredCursor));

// Test pre-image lookup for an op-style update operation.
assert.commandWorked(coll.update({_id: "x"}, {$set: {foo: "baz"}}));
latestChange = cst.getOneChange(csNoPreImages);
assert.eq(latestChange.operationType, "update");
assert(!latestChange.hasOwnProperty("fullDocumentBeforeChange"));
assert.docEq(latestChange.fullDocument, {_id: "x", foo: "baz"});
assert.docEq(latestChange.updateDescription, {updatedFields: {foo: "baz"}, removedFields: []});
// Add the expected "fullDocumentBeforeChange" and confirm that both pre-image cursors see it.
latestChange.fullDocumentBeforeChange = {
    _id: "x",
    foo: "bar"
};
assert.docEq(latestChange, cst.getOneChange(csPreImageWhenAvailableCursor));
assert.docEq(latestChange, cst.getOneChange(csPreImageRequiredCursor));

// Test pre-image lookup for a delete operation.
assert.commandWorked(coll.remove({_id: "x"}));
latestChange = cst.getOneChange(csNoPreImages);
assert.eq(latestChange.operationType, "delete");
assert(!latestChange.hasOwnProperty("fullDocument"));
assert(!latestChange.hasOwnProperty("fullDocumentBeforeChange"));
// Add the expected "fullDocumentBeforeChange" and confirm that both pre-image cursors see it.
latestChange.fullDocumentBeforeChange = {
    _id: "x",
    foo: "baz"
};
assert.docEq(latestChange, cst.getOneChange(csPreImageWhenAvailableCursor));
assert.docEq(latestChange, cst.getOneChange(csPreImageRequiredCursor));

// Now disable pre-image generation on the test collection and re-test.
assert.commandWorked(db.runCommand({collMod: coll.getName(), recordPreImages: false}));

// Test pre-image lookup for an insertion. No pre-image exists on any cursor.
assert.commandWorked(coll.insert({_id: "y"}));
latestChange = cst.getOneChange(csNoPreImages);
assert.eq(latestChange.operationType, "insert");
assert(!latestChange.hasOwnProperty("fullDocumentBeforeChange"));
assert.docEq(latestChange.fullDocument, {_id: "y"});
assert.docEq(latestChange, cst.getOneChange(csPreImageWhenAvailableCursor));
assert.docEq(latestChange, cst.getOneChange(csPreImageRequiredCursor));

// Test pre-image lookup for a replacement operation.
assert.commandWorked(coll.update({_id: "y"}, {foo: "bar"}));
latestChange = cst.getOneChange(csNoPreImages);
assert.eq(latestChange.operationType, "replace");
assert(!latestChange.hasOwnProperty("fullDocumentBeforeChange"));
assert.docEq(latestChange.fullDocument, {_id: "y", foo: "bar"});
// The "whenAvailable" cursor retrieves a document without the pre-image...
assert.docEq(latestChange, cst.getOneChange(csPreImageWhenAvailableCursor));
// ... but the "required" cursor throws an exception.
const csErr = assert.throws(() => cst.getOneChange(csPreImageRequiredCursor));
assert.eq(csErr.code, 51770);

// Test pre-image lookup for an op-style update operation.
assert.commandWorked(coll.update({_id: "y"}, {$set: {foo: "baz"}}));
latestChange = cst.getOneChange(csNoPreImages);
assert.eq(latestChange.operationType, "update");
assert(!latestChange.hasOwnProperty("fullDocumentBeforeChange"));
assert.docEq(latestChange.fullDocument, {_id: "y", foo: "baz"});
assert.docEq(latestChange.updateDescription, {updatedFields: {foo: "baz"}, removedFields: []});
// The "whenAvailable" cursor returns an event without the pre-image.
assert.docEq(latestChange, cst.getOneChange(csPreImageWhenAvailableCursor));

// Test pre-image lookup for a delete operation.
assert.commandWorked(coll.remove({_id: "y"}));
latestChange = cst.getOneChange(csNoPreImages);
assert.eq(latestChange.operationType, "delete");
assert(!latestChange.hasOwnProperty("fullDocument"));
assert(!latestChange.hasOwnProperty("fullDocumentBeforeChange"));
// The "whenAvailable" cursor returns an event without the pre-image.
assert.docEq(latestChange, cst.getOneChange(csPreImageWhenAvailableCursor));

assertDropCollection(db, coll.getName());
})();
