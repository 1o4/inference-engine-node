const ie = require('inference-engine-node');
const jimp = require('jimp');
const fs = require('fs').promises;
const {performance} = require('perf_hooks');
const {ObjectDetectionPrediction} = require('./box');

const option_definitions = [
  {
    name: 'help',
    alias: 'h',
    type: Boolean,
    description: 'Show this help message and exit.'
  },
  {
    name: 'model',
    alias: 'm',
    type: String,
    description: 'Required. Path to an .xml file with a trained model.'
  },
  {
    name: 'image',
    alias: 'i',
    type: String,
    description: 'Required. Path to an image file.'
  },
  {
    name: 'device',
    alias: 'd',
    type: String,
    defaultValue: 'CPU',
    description:
        'Optional. Specify the target device to infer on; CPU, GPU, FPGA, ' +
        'HDDL, MYRIAD or HETERO: is acceptable. Default value is CPU.'
  },
  {
    name: 'iterations',
    alias: 'n',
    type: Number,
    defaultValue: 1,
    description: 'Optional. The number of iterations for inference. ' +
        'Default value is 1.'
  },
  {
    name: 'threshold',
    alias: 't',
    type: Number,
    defaultValue: 0.5,
    description: 'Optional. The minimal probability of the visibility object. Default value is 0.5'
  },
  {
    name: 'sync',
    alias: 's',
    type: Boolean,
    defaultValue: false,
    description:
        'Optional. Specify to inference synchronously or asynchronously. ' +
        'Default value is false.'
  }
];

const commandLineArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage');

function showInputOutputInfo(info) {
  console.log(`  name: ${info.name()}`);
  console.log(`  precision: ${info.getPrecision()}`);
  console.log(`  layout: ${info.getLayout()}`);
  console.log(`  dims: [${info.getDims()}]`);
}

function showVersion(version) {
  console.log(
      `  API version: ${version.apiVersion.major}.${version.apiVersion.minor}`);
  console.log(`  Build: ${version.buildNumber}`);
  console.log(`  Description: ${version.description}`);
}

function showPluginVersions(versions) {
  Object.keys(versions).forEach(name => {
    console.log(`  Deivce Name: ${name}`);
    showVersion(versions[name]);
  });
}

function topSSDResults(tensor, threshold = 0.5, dims) {
  const result = []
  const classIdIndex = 1;
  const predictionIndex = 2;
  const x1Index = 3;
  const y1Index = 4;
  const x2Index = 5;
  const y2Index = 6;
  const dataBoxLength = dims[dims.length - 1];

  for (let b = 0; b < dims[0]; b++) {
    const batchOffset = b * dims[2];
    for (let i = 0; i < dims[2]; i++) {
      const curProposal = batchOffset + dataBoxLength * i;

      const prediction = tensor[curProposal + predictionIndex];

      if (prediction && prediction >= threshold) {
        const classId = tensor[curProposal + classIdIndex];
        const x1 = tensor[curProposal + x1Index];
        const y1 = tensor[curProposal + y1Index];
        const x2 = tensor[curProposal + x2Index];
        const y2 = tensor[curProposal + y2Index];
        result.push(new ObjectDetectionPrediction(x1, y1, x2, y2, prediction, classId));
      }
    }
  }
  return result;
}

function showResults(results, labels) {
  const class_header = labels? 'class': 'classId'
  console.log(`${class_header}`.padEnd(10) + 'probability'.padEnd(15) + 'box');
  const header = '-------';
  console.log(header.padEnd(10) + header.padEnd(15) + header);
  results.forEach(result => {
    const classId = result.classId.toString();
    let label =  labels ? labels[classId - 1] : classId;
    const probability = result.probability.toFixed(5).toString();
    const x1 = result.minX.toFixed(2).toString();
    const y1 = result.minY.toFixed(2).toString();
    const x2 = result.maxX.toFixed(2).toString();
    const y2 = result.maxY.toFixed(2).toString();
    console.log(label.padEnd(10) + probability.toString().padEnd(15) + `[${x1},${y1},${x2},${y2}]`);
  })
}

function showBreakline() {
  console.log('-------------------------------------------');
}

function highlight(msg) {
  console.log('\x1b[1m' + msg + '\x1b[0m');
}

function warning(msg) {
  console.log('\x1b[33m' + msg + '\x1b[0m');
}

async function main() {
  const options = commandLineArgs(option_definitions);
  if (options.help || !options.image || !options.model) {
    const usage = commandLineUsage([
      {
        header: 'Hello Classification',
        content:
            'An example of image classification using inference-engine-node.'
      },
      {header: 'Options', optionList: option_definitions}
    ]);
    console.log(usage);
    process.exit(0);
  }

  const model_path = options.model;
  const re = /\.xml$/g
  const bin_path = model_path.replace(re, '.bin');
  const labels_path = model_path.replace(re, '.labels');
  const device_name = options.device;
  const image_path = options.image;
  const iterations = options.iterations;
  const threshold = options.threshold;
  const sync = options.sync;

  if (iterations <= 0) {
    warning('The number of iterations should be greater than 0.');
    process.exit(0);
  }
  console.log('Start.')
  showBreakline();
  console.log(`Check inference engine version: `);
  showVersion(ie.getVersion());
  showBreakline();
  const core = ie.createCore();
  console.log(`Start to create network from ${model_path}.`)
  let start_time = performance.now();
  let net = await core.readNetwork(model_path, bin_path);
  const create_network_time = performance.now() - start_time;
  highlight(
      `Succeeded: read network took ${create_network_time.toFixed(2)} ms.`);
  console.log(`Network name: ${net.getName()}`);
  const inputs_info = net.getInputsInfo();
  inputs_info.forEach((info, i) => {
    console.log(`Input[${i}]:`)
    showInputOutputInfo(info);
  });
  const outputs_info = net.getOutputsInfo();
  outputs_info.forEach((info, i) => {
    console.log(`Output[${i}]:`)
    showInputOutputInfo(info);
  });
  const input_info = inputs_info[0];
  console.log(`Change input layout to 'nhwc' and precision to 'u8'.`);
  input_info.setLayout('nhwc');
  input_info.setPrecision('u8');
  const output_info = outputs_info[0];
  showBreakline();
  console.log(`Start to read image from ${image_path}.`);
  const image = await jimp.read(image_path);
  console.log(`Succeeded.`);
  const input_dims = input_info.getDims();
  const input_height = input_dims[2];
  const input_width = input_dims[3];
  if (image.bitmap.height !== input_height &&
      image.bitmap.width !== input_width) {
    console.log(`Resize image from (${image.bitmap.height}, ${
        image.bitmap.width}) to (${input_height}, ${input_width}).`);
    image.resize(input_width, input_height, jimp.RESIZE_BILINEAR);
  }
  showBreakline();
  console.log(`Check ${device_name} plugin version:`);
  showPluginVersions(core.getVersions(device_name));
  console.log(`Start to load network to ${device_name} plugin.`)
  start_time = performance.now();
  const exec_net = await core.loadNetwork(net, device_name);
  const load_network_time = performance.now() - start_time;
  highlight(`Succeeded: load network took ${load_network_time.toFixed(2)} ms.`);
  showBreakline();
  let infer_req;
  let infer_time = [];
  console.log(`Start to infer ${sync ? '' : 'a'}synchronously for ${
      iterations} iterations.`);
  for (let i = 0; i < iterations; i++) {
    start_time = performance.now();
    infer_req = exec_net.createInferRequest();
    const input_blob = infer_req.getBlob(input_info.name());
    const input_data = new Uint8Array(input_blob.wmap());
    image.scan(
        0, 0, image.bitmap.width, image.bitmap.height, function(x, y, idx) {
          // Convert from RGBA to BGR (IE default)
          let i = Math.floor(idx / 4) * 3;
          input_data[i + 2] = image.bitmap.data[idx + 0];  // R
          input_data[i + 1] = image.bitmap.data[idx + 1];  // G
          input_data[i + 0] = image.bitmap.data[idx + 2];  // B
        });
    input_blob.unmap();
    start_time = performance.now();
    if (sync) {
      infer_req.infer();
    } else {
      await infer_req.startAsync();
    }
    infer_time.push(performance.now() - start_time);
  }
  const average_infer_time =
      infer_time.reduce((acc, v) => acc + v, 0) / infer_time.length;
  highlight(`Succeeded: the average inference time is ${
      average_infer_time.toFixed(2)} ms.`);
  highlight(`           the throughput is ${
      (1000 / average_infer_time).toFixed(2)} FPS.`);
  let labels = undefined;
  try {
    const data = await fs.readFile(labels_path, {encoding: 'utf-8'});
    labels = data.split('\n');
  } catch (error) {
    warning(error);
  }
  const output_blob = infer_req.getBlob(output_info.name());
  const output_data = new Float32Array(output_blob.rmap());
  const results = topSSDResults(output_data, threshold, output_info.getDims());
  output_blob.unmap();
  console.log(`Found ${results.length} objects:`);
  showResults(results, labels);
  showBreakline();
  return 'Done.';
}

main().then(console.log).catch(warning);
