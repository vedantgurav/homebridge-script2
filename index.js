let Service;
let Characteristic;

const exec = require("child_process").exec;
const fileExists = require("file-exists");
const chokidar = require("chokidar");

module.exports = function (homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory(
    "homebridge-script2",
    "Script2",
    script2Accessory
  );
};

function script2Accessory(log, config) {
  this.log = log;
  this.service = "LockMechanism";

  this.name = config["name"];
  this.onCommand = config["on"];
  this.offCommand = config["off"];
  this.stateCommand = config["state"] || false;
  this.onValue = config["on_value"] || "true";
  this.fileState = config["fileState"] || false;
  this.uniqueSerial = config["unique_serial"] || "script2 Serial Number";
  this.onValue = this.onValue.trim().toLowerCase();

  this.currentState = Characteristic.LockCurrentState.SECURED;
  if (this.fileState) {
    try {
      if (fileExists.sync(this.fileState)) {
        this.currentState = Characteristic.LockCurrentState.UNSECURED;
      }
    } catch (err) {
      this.log.error(`Error checking initial file state: ${err.message}`);
    }
  }

  this.setStateHandler = function (targetLockState, callback) {
    const command =
      targetLockState === Characteristic.LockTargetState.UNSECURED
        ? this.onCommand
        : this.offCommand;

    if (!command) {
      const stateString = targetLockState === Characteristic.LockTargetState.UNSECURED ? "UNSECURED" : "SECURED";
      this.log.warn(`No command defined for ${stateString} state.`);
      const currentActualState = this.currentState;
      const targetAsCurrentState = targetLockState === Characteristic.LockTargetState.UNSECURED ? Characteristic.LockCurrentState.UNSECURED : Characteristic.LockCurrentState.SECURED;

      if (currentActualState === targetAsCurrentState) {
         this.log.info(`Already in desired state ${stateString}.`);
         callback(null);
         return;
      }
      callback(new Error(`No command defined for ${stateString}`));
      return;
    }

    this.log.debug(`Executing command: ${command}`);
    exec(command, (error, stdout, stderr) => {
      if (error || stderr) {
        const errMessage = stderr
          ? `${stderr} (${error?.message ?? "unknown error"})`
          : `${error?.message ?? "unknown error"}`;
        this.log.error(`Set State returned an error: ${errMessage}`);
        callback(new Error(errMessage));
        return;
      }

      const commandOutput = stdout.trim().toLowerCase();
      this.log.debug(`Set State Command returned ${commandOutput}`);

      const newCurrentState =
        targetLockState === Characteristic.LockTargetState.UNSECURED
          ? Characteristic.LockCurrentState.UNSECURED
          : Characteristic.LockCurrentState.SECURED;
      
      this.currentState = newCurrentState;
      const stateString = newCurrentState === Characteristic.LockCurrentState.UNSECURED ? "UNSECURED" : "SECURED";
      this.log.info(`Set ${this.name} to ${stateString}`);

      if (this.lockService) {
        this.lockService.updateCharacteristic(
          Characteristic.LockCurrentState,
          newCurrentState
        );
      }
      callback(null);
    });
  };

  this.getStateHandler = function (callback) {
    function getStateHandlerExecCallback(error, stdout, stderr) {
      if (error || stderr) {
        const errMessage = stderr
          ? `${stderr} (${error?.message ?? 'unknown error'})`
          : `${error?.message ?? 'unknown error'}`;
        this.log.error(`Get State returned an error: ${errMessage}`);
        callback(new Error(errMessage), null);
        return;
      }

      const cleanCommandOutput = stdout.trim().toLowerCase();
      this.log.debug(`Get State Command returned ${cleanCommandOutput}`);

      const currentLockState =
        cleanCommandOutput == this.onValue
          ? Characteristic.LockCurrentState.UNSECURED
          : Characteristic.LockCurrentState.SECURED;
      const stateString = currentLockState === Characteristic.LockCurrentState.UNSECURED ? "UNSECURED" : "SECURED";
      this.log.info(`State of ${this.name} is: ${stateString}`);
      callback(null, currentLockState);
    }

    const command = this.stateCommand;
    this.log.debug(`Executing command: ${command}`);
    exec(command, getStateHandlerExecCallback.bind(this));
  };

  this.getFileStateHandler = function (callback) {
    try {
      const fileIsPresent = fileExists.sync(this.fileState);
      const currentLockState = fileIsPresent
        ? Characteristic.LockCurrentState.UNSECURED
        : Characteristic.LockCurrentState.SECURED;
      const stateString = currentLockState === Characteristic.LockCurrentState.UNSECURED ? "UNSECURED" : "SECURED";
      this.log.info(`State of ${this.name} is: ${stateString}`);
      callback(null, currentLockState);
    } catch (err) {
      this.log.error(`Error checking file state: ${err.message}`);
      callback(err, null);
    }
  };
}

script2Accessory.prototype.setState = function (lockState, callback) {
  const targetStateString = lockState === Characteristic.LockTargetState.UNSECURED ? "UNSECURED" : "SECURED";
  this.log.info(`Setting ${this.name} to ${targetStateString}...`);
  this.setStateHandler(lockState, callback);
};

script2Accessory.prototype.getState = function (callback) {
  this.log.info(`Getting ${this.name} state...`);
  if (this.fileState) {
    this.getFileStateHandler(callback);
  } else if (this.stateCommand) {
    this.getStateHandler(callback);
  } else {
    this.log.warn("No fileState or stateCommand configured. Reporting internal state.");
    const stateString = this.currentState === Characteristic.LockCurrentState.UNSECURED ? "UNSECURED" : "SECURED";
    this.log.info(`Current internal state of ${this.name} is: ${stateString}`);
    callback(null, this.currentState);
  }
};

script2Accessory.prototype.getServices = function () {
  const informationService = new Service.AccessoryInformation();
  this.lockService = new Service.LockMechanism(this.name);

  informationService
    .setCharacteristic(Characteristic.Manufacturer, "script2 Manufacturer")
    .setCharacteristic(Characteristic.Model, "script2 Model")
    .setCharacteristic(Characteristic.SerialNumber, this.uniqueSerial.toString());

  this.lockService
    .getCharacteristic(Characteristic.LockTargetState)
    .on("set", this.setState.bind(this));

  if (this.stateCommand || this.fileState) {
    this.lockService
      .getCharacteristic(Characteristic.LockCurrentState)
      .on("get", this.getState.bind(this));
  } else {
    this.lockService.setCharacteristic(
      Characteristic.LockCurrentState,
      this.currentState
    );
  }

  if (this.fileState) {
    const fileCreatedHandler = function (path, stats) {
      if (this.currentState === Characteristic.LockCurrentState.SECURED) {
        this.log.info(`File "${path}" was created, setting state to UNSECURED`);
        this.currentState = Characteristic.LockCurrentState.UNSECURED;
        this.lockService.updateCharacteristic(
          Characteristic.LockCurrentState,
          Characteristic.LockCurrentState.UNSECURED
        );
      }
    }.bind(this);

    const fileRemovedHandler = function (path, stats) {
      if (this.currentState === Characteristic.LockCurrentState.UNSECURED) {
        this.log.info(`File "${path}" was deleted, setting state to SECURED`);
        this.currentState = Characteristic.LockCurrentState.SECURED;
        this.lockService.updateCharacteristic(
          Characteristic.LockCurrentState,
          Characteristic.LockCurrentState.SECURED
        );
      }
    }.bind(this);

    const watcher = chokidar.watch(this.fileState, { alwaysStat: true, ignoreInitial: true });
    watcher.on("add", fileCreatedHandler);
    watcher.on("unlink", fileRemovedHandler);
  }
  return [informationService, this.lockService];
};
