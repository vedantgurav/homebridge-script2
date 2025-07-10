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
		script2Accessory,
	);
};

function script2Accessory(log, config) {
	this.log = log;

	const serviceType = config["serviceType"];
	const isLock = serviceType == "lock";

	this.service = isLock ? "LockMechanism" : "Switch";

	this.name = config["name"];
	this.onCommand = config["on"];
	this.offCommand = config["off"];
	this.stateCommand = config["state"] || false;
	this.onValue = config["on_value"] || "true";
	this.fileState = config["fileState"] || false;
	this.uniqueSerial = config["unique_serial"] || "script2 Serial Number";
	this.onValue = this.onValue.trim().toLowerCase();
	this.isLock = isLock;

	// Initialize current state based on service type
	if (isLock) {
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
	} else {
		this.currentState = false; // Switch OFF
		if (this.fileState) {
			try {
				if (fileExists.sync(this.fileState)) {
					this.currentState = true; // Switch ON
				}
			} catch (err) {
				this.log.error(`Error checking initial file state: ${err.message}`);
			}
		}
	}

	this.setStateHandler = function (targetState, callback) {
		let command;
		if (isLock) {
			command =
				targetState === Characteristic.LockTargetState.UNSECURED
					? this.onCommand
					: this.offCommand;
		} else {
			command = targetState ? this.onCommand : this.offCommand;
		}

		if (!command) {
			let stateString;
			if (isLock) {
				stateString =
					targetState === Characteristic.LockTargetState.UNSECURED
						? "UNSECURED"
						: "SECURED";
			} else {
				stateString = targetState ? "ON" : "OFF";
			}

			this.log.warn(`No command defined for ${stateString} state.`);

			// Check if already in desired state
			let currentActualState = this.currentState;
			let targetAsCurrentState;
			if (isLock) {
				targetAsCurrentState =
					targetState === Characteristic.LockTargetState.UNSECURED
						? Characteristic.LockCurrentState.UNSECURED
						: Characteristic.LockCurrentState.SECURED;
			} else {
				targetAsCurrentState = targetState;
			}

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

			// Update current state based on service type
			if (isLock) {
				const newCurrentState =
					targetState === Characteristic.LockTargetState.UNSECURED
						? Characteristic.LockCurrentState.UNSECURED
						: Characteristic.LockCurrentState.SECURED;
				this.currentState = newCurrentState;
				const stateString =
					newCurrentState === Characteristic.LockCurrentState.UNSECURED
						? "UNSECURED"
						: "SECURED";
				this.log.info(`Set ${this.name} to ${stateString}`);

				if (this.accessoryService) {
					this.accessoryService.updateCharacteristic(
						Characteristic.LockCurrentState,
						newCurrentState,
					);
				}
			} else {
				this.currentState = targetState;
				const stateString = targetState ? "ON" : "OFF";
				this.log.info(`Set ${this.name} to ${stateString}`);

				if (this.accessoryService) {
					this.accessoryService.updateCharacteristic(
						Characteristic.On,
						targetState,
					);
				}
			}
			callback(null);
		});
	};

	this.getStateHandler = function (callback) {
		function getStateHandlerExecCallback(error, stdout, stderr) {
			if (error || stderr) {
				const errMessage = stderr
					? `${stderr} (${error?.message ?? "unknown error"})`
					: `${error?.message ?? "unknown error"}`;
				this.log.error(`Get State returned an error: ${errMessage}`);
				callback(new Error(errMessage), null);
				return;
			}

			const cleanCommandOutput = stdout.trim().toLowerCase();
			this.log.debug(`Get State Command returned ${cleanCommandOutput}`);

			if (isLock) {
				const currentLockState =
					cleanCommandOutput == this.onValue
						? Characteristic.LockCurrentState.UNSECURED
						: Characteristic.LockCurrentState.SECURED;
				const stateString =
					currentLockState === Characteristic.LockCurrentState.UNSECURED
						? "UNSECURED"
						: "SECURED";
				this.log.info(`State of ${this.name} is: ${stateString}`);
				callback(null, currentLockState);
			} else {
				const currentSwitchState = cleanCommandOutput == this.onValue;
				const stateString = currentSwitchState ? "ON" : "OFF";
				this.log.info(`State of ${this.name} is: ${stateString}`);
				callback(null, currentSwitchState);
			}
		}

		const command = this.stateCommand;
		this.log.debug(`Executing command: ${command}`);
		exec(command, getStateHandlerExecCallback.bind(this));
	};

	this.getFileStateHandler = function (callback) {
		try {
			const fileIsPresent = fileExists.sync(this.fileState);

			if (isLock) {
				const currentLockState = fileIsPresent
					? Characteristic.LockCurrentState.UNSECURED
					: Characteristic.LockCurrentState.SECURED;
				const stateString =
					currentLockState === Characteristic.LockCurrentState.UNSECURED
						? "UNSECURED"
						: "SECURED";
				this.log.info(`State of ${this.name} is: ${stateString}`);
				callback(null, currentLockState);
			} else {
				const currentSwitchState = fileIsPresent;
				const stateString = currentSwitchState ? "ON" : "OFF";
				this.log.info(`State of ${this.name} is: ${stateString}`);
				callback(null, currentSwitchState);
			}
		} catch (err) {
			this.log.error(`Error checking file state: ${err.message}`);
			callback(err, null);
		}
	};
}

script2Accessory.prototype.setState = function (targetState, callback) {
	if (this.isLock) {
		const targetStateString =
			targetState === Characteristic.LockTargetState.UNSECURED
				? "UNSECURED"
				: "SECURED";
		this.log.info(`Setting ${this.name} to ${targetStateString}...`);
	} else {
		const targetStateString = targetState ? "ON" : "OFF";
		this.log.info(`Setting ${this.name} to ${targetStateString}...`);
	}
	this.setStateHandler(targetState, callback);
};

script2Accessory.prototype.getState = function (callback) {
	this.log.info(`Getting ${this.name} state...`);
	if (this.fileState) {
		this.getFileStateHandler(callback);
	} else if (this.stateCommand) {
		this.getStateHandler(callback);
	} else {
		this.log.warn(
			"No fileState or stateCommand configured. Reporting internal state.",
		);

		if (this.isLock) {
			const stateString =
				this.currentState === Characteristic.LockCurrentState.UNSECURED
					? "UNSECURED"
					: "SECURED";
			this.log.info(
				`Current internal state of ${this.name} is: ${stateString}`,
			);
		} else {
			const stateString = this.currentState ? "ON" : "OFF";
			this.log.info(
				`Current internal state of ${this.name} is: ${stateString}`,
			);
		}
		callback(null, this.currentState);
	}
};

script2Accessory.prototype.getServices = function () {
	const informationService = new Service.AccessoryInformation();

	// Create service based on type
	if (this.isLock) {
		this.accessoryService = new Service.LockMechanism(this.name);
	} else {
		this.accessoryService = new Service.Switch(this.name);
	}

	informationService
		.setCharacteristic(Characteristic.Manufacturer, "script2 Manufacturer")
		.setCharacteristic(Characteristic.Model, "script2 Model")
		.setCharacteristic(
			Characteristic.SerialNumber,
			this.uniqueSerial.toString(),
		);

	// Set up characteristics based on service type
	if (this.isLock) {
		this.accessoryService
			.getCharacteristic(Characteristic.LockTargetState)
			.on("set", this.setState.bind(this));

		if (this.stateCommand || this.fileState) {
			this.accessoryService
				.getCharacteristic(Characteristic.LockCurrentState)
				.on("get", this.getState.bind(this));
		} else {
			this.accessoryService.setCharacteristic(
				Characteristic.LockCurrentState,
				this.currentState,
			);
		}
	} else {
		this.accessoryService
			.getCharacteristic(Characteristic.On)
			.on("set", this.setState.bind(this));

		if (this.stateCommand || this.fileState) {
			this.accessoryService
				.getCharacteristic(Characteristic.On)
				.on("get", this.getState.bind(this));
		} else {
			this.accessoryService.setCharacteristic(
				Characteristic.On,
				this.currentState,
			);
		}
	}

	// File state monitoring
	if (this.fileState) {
		const fileCreatedHandler = function (path, stats) {
			if (this.isLock) {
				if (this.currentState === Characteristic.LockCurrentState.SECURED) {
					this.log.info(
						`File "${path}" was created, setting state to UNSECURED`,
					);
					this.currentState = Characteristic.LockCurrentState.UNSECURED;
					this.accessoryService.updateCharacteristic(
						Characteristic.LockCurrentState,
						Characteristic.LockCurrentState.UNSECURED,
					);
				}
			} else {
				if (this.currentState === false) {
					this.log.info(`File "${path}" was created, setting state to ON`);
					this.currentState = true;
					this.accessoryService.updateCharacteristic(Characteristic.On, true);
				}
			}
		}.bind(this);

		const fileRemovedHandler = function (path, stats) {
			if (this.isLock) {
				if (this.currentState === Characteristic.LockCurrentState.UNSECURED) {
					this.log.info(`File "${path}" was deleted, setting state to SECURED`);
					this.currentState = Characteristic.LockCurrentState.SECURED;
					this.accessoryService.updateCharacteristic(
						Characteristic.LockCurrentState,
						Characteristic.LockCurrentState.SECURED,
					);
				}
			} else {
				if (this.currentState === true) {
					this.log.info(`File "${path}" was deleted, setting state to OFF`);
					this.currentState = false;
					this.accessoryService.updateCharacteristic(Characteristic.On, false);
				}
			}
		}.bind(this);

		const watcher = chokidar.watch(this.fileState, {
			alwaysStat: true,
			ignoreInitial: true,
		});
		watcher.on("add", fileCreatedHandler);
		watcher.on("unlink", fileRemovedHandler);
	}
	return [informationService, this.accessoryService];
};
